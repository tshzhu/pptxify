import {
  ConversionError,
  MAX_PAGES,
  calculatePageSize,
  createPixelEstimate,
  isSamePageSize,
  parsePpi,
  type PageSize,
  type PixelEstimate,
} from './limits.js';

/** PDF properties that do not depend on the requested output PPI. */
export type DocumentInspection = PageSize & { pageCount: number };

export type PageInspectionSource = {
  numPages: number;
  getPage(pageNumber: number): Promise<{
    getViewport(options: { scale: number }): { width: number; height: number };
    cleanup(): void | boolean | Promise<void | boolean>;
  }>;
};

export type InspectionProgress = (current: number, total: number, detail: string) => void;

const MAX_PARALLEL_PAGE_PIXELS = 4_000_000;

export function chooseRenderConcurrency(pagePixels: number, availableWorkers?: number): number {
  const workers = availableWorkers ?? (
    typeof navigator === 'undefined' ? 1 : Math.max(1, navigator.hardwareConcurrency || 1)
  );
  return workers >= 2
    && Number.isFinite(pagePixels)
    && pagePixels > 0
    && pagePixels <= MAX_PARALLEL_PAGE_PIXELS
    ? 2
    : 1;
}

/**
 * Render indexed work with a small bounded window, consuming results in input
 * order so callers do not have to retain the entire document in memory.
 */
export async function processInOrder<T>(
  count: number,
  concurrency: number,
  worker: (index: number) => Promise<T>,
  consume: (index: number, value: T) => void | Promise<void>,
): Promise<void> {
  if (count <= 0) return;

  const inFlight = new Map<number, Promise<T>>();
  let nextToStart = 0;
  const windowSize = Number.isFinite(concurrency)
    ? Math.max(1, Math.min(count, Math.floor(concurrency)))
    : 1;
  const startMore = (): void => {
    while (nextToStart < count && inFlight.size < windowSize) {
      const index = nextToStart;
      nextToStart += 1;
      inFlight.set(index, worker(index));
    }
  };

  try {
    startMore();
    for (let index = 0; index < count; index += 1) {
      const promise = inFlight.get(index);
      if (!promise) throw new Error(`Missing work item ${index}.`);
      const value = await promise;
      inFlight.delete(index);
      await consume(index, value);
      startMore();
    }
  } catch (error) {
    await Promise.allSettled(inFlight.values());
    throw error;
  }
}

export function inspectionProgressPercent(current: number, total: number): number {
  return current === total ? 10 : 5 + Math.round((current / total) * 5);
}

/** Inspect page count and physical dimensions without applying a PPI budget. */
export async function inspectPdfDocument(
  pdf: PageInspectionSource,
  signal?: AbortSignal,
  onProgress?: InspectionProgress,
): Promise<DocumentInspection> {
  throwIfAborted(signal);
  if (pdf.numPages <= 0) {
    throw new ConversionError('PDF_LOAD_FAILED', 'The PDF has no pages to convert.');
  }
  if (pdf.numPages > MAX_PAGES) {
    throw new ConversionError('PAGE_LIMIT', `PDFs cannot have more than ${MAX_PAGES} pages.`);
  }

  onProgress?.(0, pdf.numPages, `Inspecting the size of ${pdf.numPages} pages…`);
  const firstPage = await pdf.getPage(1);
  const firstViewport = firstPage.getViewport({ scale: 1 });
  const reference = calculatePageSize(firstViewport.width, firstViewport.height);
  await firstPage.cleanup();

  for (let pageNumber = 2; pageNumber <= pdf.numPages; pageNumber += 1) {
    throwIfAborted(signal);
    const page = await pdf.getPage(pageNumber);
    try {
      const viewport = page.getViewport({ scale: 1 });
      const pageSize = calculatePageSize(viewport.width, viewport.height);
      if (!isSamePageSize(pageSize.widthPt, pageSize.heightPt, reference)) {
        throw new ConversionError(
          'MIXED_PAGE_SIZE',
          `Page ${pageNumber} has a different size from page 1. All pages must use the same size.`,
        );
      }
    } finally {
      await page.cleanup();
    }
    onProgress?.(pageNumber, pdf.numPages, `Checking page ${pageNumber}/${pdf.numPages}…`);
  }

  onProgress?.(pdf.numPages, pdf.numPages, 'Page size check complete.');
  return { ...reference, pageCount: pdf.numPages };
}

/** Apply the shared PPI and pixel safety rules to inspected PDF dimensions. */
export function estimateDocument(
  inspection: Pick<DocumentInspection, 'widthPt' | 'heightPt' | 'pageCount'>,
  ppi: number | string,
): PixelEstimate {
  return createPixelEstimate(
    inspection.widthPt,
    inspection.heightPt,
    parsePpi(ppi),
    inspection.pageCount,
  );
}

export async function assertPdfSignature(file: Blob): Promise<void> {
  const header = new TextDecoder().decode(new Uint8Array(await file.slice(0, 5).arrayBuffer()));
  if (header !== '%PDF-') {
    throw new ConversionError('INVALID_FILE', 'This file is not a valid PDF (the PDF header is missing).');
  }
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new ConversionError('CANCELLED', 'Conversion cancelled.');
  }
}
