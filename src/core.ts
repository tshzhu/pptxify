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
