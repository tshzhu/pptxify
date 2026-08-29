import {
  AnnotationMode,
  GlobalWorkerOptions,
  getDocument,
  type PDFDocumentLoadingTask,
  type PDFDocumentProxy,
  type PDFPageProxy,
} from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';
import PptxGenJS from 'pptxgenjs';

import {
  ConversionError,
  makeOutputFileName,
  parsePpi,
  validateFileSize,
  type PageGeometry,
  type PageSize,
  type PixelEstimate,
} from './limits.js';
import {
  assertPdfSignature,
  estimateDocument,
  inspectionProgressPercent,
  inspectPdfDocument,
  chooseRenderConcurrency,
  mapWithConcurrency,
  throwIfAborted,
} from './core.js';

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export type ProgressStage = 'loading' | 'inspecting' | 'rendering' | 'packaging' | 'annotating';

export interface ConversionProgress {
  stage: ProgressStage;
  current: number;
  total: number;
  percent: number;
  detail: string;
}

export interface PdfInspection extends PageSize {
  fileName: string;
  pageCount: number;
  fileSize: number;
}

export type ConversionResult = PdfInspection & PixelEstimate & {
  outputFileName: string;
  outputBlob: Blob;
};

export interface ConversionOptions {
  ppi: number;
  signal?: AbortSignal;
  onProgress?: (progress: ConversionProgress) => void;
  inspection?: PdfInspection;
}

function assetDirectory(name: string): string {
  return new URL(`pdfjs/${name}/`, new URL(import.meta.env.BASE_URL, window.location.href)).toString();
}

function report(
  onProgress: ConversionOptions['onProgress'],
  stage: ProgressStage,
  current: number,
  total: number,
  percent: number,
  detail: string,
): void {
  onProgress?.({ stage, current, total, percent, detail });
}

function classifyPdfError(error: unknown): ConversionError {
  if (error instanceof ConversionError) return error;
  const message = error instanceof Error ? error.message : String(error);
  if (/password|encrypted/i.test(message)) {
    return new ConversionError('PASSWORD_PROTECTED', 'Password-protected PDFs are not supported in this preview.', { cause: error });
  }
  return new ConversionError('PDF_LOAD_FAILED', `Could not read the PDF: ${message || 'unknown error'}`, { cause: error });
}

async function createLoadingTask(file: File): Promise<PDFDocumentLoadingTask> {
  const data = await file.arrayBuffer();
  const loadingTask = getDocument({
    data,
    cMapUrl: assetDirectory('cmaps'),
    cMapPacked: true,
    standardFontDataUrl: assetDirectory('standard_fonts'),
    iccUrl: assetDirectory('iccs'),
    wasmUrl: assetDirectory('wasm'),
    useWorkerFetch: true,
    useSystemFonts: true,
    maxImageSize: -1,
  });

  loadingTask.onPassword = () => {
    throw new ConversionError('PASSWORD_PROTECTED', 'Password-protected PDFs are not supported in this preview.');
  };
  return loadingTask;
}

async function withPdfDocument<T>(
  file: File,
  callback: (pdf: PDFDocumentProxy, loadingTask: PDFDocumentLoadingTask) => Promise<T>,
): Promise<T> {
  const loadingTask = await createLoadingTask(file);
  let pdf: PDFDocumentProxy | undefined;
  try {
    pdf = await loadingTask.promise;
    return await callback(pdf, loadingTask);
  } catch (error) {
    throw classifyPdfError(error);
  } finally {
    if (pdf) {
      try {
        await pdf.cleanup();
      } catch {
        // Destruction below is still attempted if PDF.js cannot clean a page cache.
      }
    }
    try {
      await loadingTask.destroy();
    } catch {
      // The original conversion error is more useful than a secondary worker error.
    }
  }
}

export async function inspectPdfFile(
  file: File,
  signal?: AbortSignal,
): Promise<PdfInspection> {
  validateFileSize(file);
  await assertPdfSignature(file);
  const inspection = await withPdfDocument(file, (pdf) => inspectPdfDocument(pdf, signal));
  return { ...inspection, fileName: file.name, fileSize: file.size };
}

function canvasToPngDataUrl(canvas: HTMLCanvasElement): Promise<string> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new ConversionError('PNG_EXPORT_FAILED', 'The browser could not export a PNG image.'));
        return;
      }
      blob.arrayBuffer().then((buffer) => {
        const bytes = new Uint8Array(buffer);
        let binary = '';
        const chunkSize = 0x8000;
        for (let offset = 0; offset < bytes.length; offset += chunkSize) {
          binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length)));
        }
        resolve(`data:image/png;base64,${btoa(binary)}`);
      }, (error: unknown) => {
        reject(new ConversionError('PNG_EXPORT_FAILED', 'Could not read the PNG image.', { cause: error }));
      });
    }, 'image/png');
  });
}

async function renderPageToPng(
  page: PDFPageProxy,
  geometry: PageGeometry,
  signal?: AbortSignal,
): Promise<string> {
  throwIfAborted(signal);
  const scale = geometry.pixelWidth / geometry.widthPt;
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = geometry.pixelWidth;
  canvas.height = geometry.pixelHeight;

  const context = canvas.getContext('2d', { alpha: false });
  if (!context) {
    throw new ConversionError('CANVAS_UNAVAILABLE', 'This browser cannot create a 2D canvas.');
  }
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);

  const renderTask = page.render({
    canvas,
    canvasContext: context,
    viewport,
    intent: 'print',
    annotationMode: AnnotationMode.ENABLE,
    background: '#ffffff',
  });
  const cancelRender = () => renderTask.cancel();
  signal?.addEventListener('abort', cancelRender, { once: true });
  try {
    await renderTask.promise;
    throwIfAborted(signal);
    return await canvasToPngDataUrl(canvas);
  } catch (error) {
    if (signal?.aborted) {
      throw new ConversionError('CANCELLED', 'Conversion cancelled.', { cause: error });
    }
    throw error;
  } finally {
    signal?.removeEventListener('abort', cancelRender);
    canvas.width = 1;
    canvas.height = 1;
  }
}

export async function convertPdfToPptx(
  file: File,
  options: ConversionOptions,
): Promise<ConversionResult> {
  validateFileSize(file);
  await assertPdfSignature(file);
  const ppi = parsePpi(options.ppi);
  throwIfAborted(options.signal);
  report(options.onProgress, 'loading', 0, 1, 0, 'Loading PDF…');

  return withPdfDocument(file, async (pdf) => {
    const inspection = options.inspection
      && options.inspection.fileName === file.name
      && options.inspection.fileSize === file.size
      ? options.inspection
      : await inspectPdfDocument(
        pdf,
        options.signal,
        (current, total, detail) => report(
          options.onProgress,
          'inspecting',
          current,
          total,
          inspectionProgressPercent(current, total),
          detail,
        ),
      );
    const estimate = estimateDocument(inspection, ppi);
    const pptx = new PptxGenJS();
    const layoutName = 'PDF_CUSTOM';
    pptx.defineLayout({ name: layoutName, width: estimate.widthIn, height: estimate.heightIn });
    pptx.layout = layoutName;
    pptx.author = 'pptxify';
    pptx.company = 'pptxify';
    pptx.subject = `Rasterized at ${ppi} PPI`;
    pptx.title = file.name.replace(/\.[^/.]+$/, '') || 'PDF presentation';

    const geometry = estimate;
    const concurrency = chooseRenderConcurrency(geometry.pixels);
    let completedPages = 0;
    const imageData = await mapWithConcurrency(pdf.numPages, concurrency, async (index) => {
      const pageNumber = index + 1;
      report(options.onProgress, 'rendering', pageNumber - 1, pdf.numPages, 10 + Math.round((index / pdf.numPages) * 80), `Rendering page ${pageNumber}/${pdf.numPages}…`);
      const page = await pdf.getPage(pageNumber);
      try {
        const image = await renderPageToPng(page, geometry, options.signal);
        completedPages += 1;
        report(options.onProgress, 'rendering', completedPages, pdf.numPages, 10 + Math.round((completedPages / pdf.numPages) * 80), `Rendered page ${pageNumber}/${pdf.numPages}.`);
        return image;
      } finally {
        await page.cleanup();
      }
    });
    for (let pageNumber = 1; pageNumber <= imageData.length; pageNumber += 1) {
      const image = imageData[pageNumber - 1];
      const slide = pptx.addSlide();
      slide.background = { color: 'FFFFFF' };
      slide.addImage({
        data: image,
        x: 0,
        y: 0,
        w: estimate.widthIn,
        h: estimate.heightIn,
        altText: `PDF page ${pageNumber}`,
        objectName: `PDF page ${pageNumber}`,
      });
      // Keep an empty notes container in the cached PPTX. The optional notes
      // stage patches these XML parts later without rerendering the PDF.
      slide.addNotes('');
    }

    throwIfAborted(options.signal);
    report(options.onProgress, 'packaging', pdf.numPages, pdf.numPages, 92, 'Packaging PPTX…');
    try {
      const outputFileName = makeOutputFileName(file.name, ppi);
      const output = await pptx.write({ outputType: 'blob', compression: true });
      const outputBlob = output instanceof Blob
        ? output
        : new Blob([copyBytesToArrayBuffer(output)], {
            type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          });
      report(options.onProgress, 'packaging', pdf.numPages, pdf.numPages, 100, 'PPTX is ready to download.');
      return { ...inspection, ...estimate, fileName: file.name, fileSize: file.size, outputFileName, outputBlob };
    } catch (error) {
      throw new ConversionError('PPTX_FAILED', `Could not create the PPTX: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
  });
}

function copyBytesToArrayBuffer(output: string | ArrayBuffer | Blob | Uint8Array): ArrayBuffer {
  if (typeof output === 'string') return new TextEncoder().encode(output).buffer;
  if (output instanceof Blob) return new ArrayBuffer(0);
  const bytes = output instanceof Uint8Array ? output : new Uint8Array(output);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}
