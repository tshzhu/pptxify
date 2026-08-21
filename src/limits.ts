export const MIN_PPI = 1;
export const MAX_PPI = 1200;
export const DEFAULT_PPI = 600;

export const MAX_FILE_BYTES = 100 * 1024 * 1024;
export const MAX_PAGES = 120;
export const MAX_CANVAS_SIDE = 8192;
export const MAX_PIXELS_PER_PAGE = 50_000_000;
export const MAX_TOTAL_PIXELS = 400_000_000;
export const PAGE_SIZE_TOLERANCE_PT = 0.02;

export type ErrorCode =
  | 'INVALID_PPI'
  | 'INVALID_FILE'
  | 'FILE_TOO_LARGE'
  | 'PAGE_LIMIT'
  | 'PIXEL_LIMIT'
  | 'MIXED_PAGE_SIZE'
  | 'PASSWORD_PROTECTED'
  | 'PDF_LOAD_FAILED'
  | 'CANVAS_UNAVAILABLE'
  | 'PNG_EXPORT_FAILED'
  | 'CANCELLED'
  | 'PPTX_FAILED';

export class ConversionError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ConversionError';
    this.code = code;
  }
}

export interface PageGeometry {
  widthPt: number;
  heightPt: number;
  widthIn: number;
  heightIn: number;
  pixelWidth: number;
  pixelHeight: number;
  pixels: number;
}

export interface PixelEstimate extends PageGeometry {
  pageCount: number;
  totalPixels: number;
  rawMemoryBytes: number;
}

export function parsePpi(value: number | string): number {
  const ppi = typeof value === 'number' ? value : Number(value.trim());
  if (!Number.isInteger(ppi) || ppi < MIN_PPI || ppi > MAX_PPI) {
    throw new ConversionError(
      'INVALID_PPI',
      `PPI must be an integer between ${MIN_PPI} and ${MAX_PPI}.`,
    );
  }
  return ppi;
}

export function calculatePageGeometry(
  widthPt: number,
  heightPt: number,
  ppi: number,
): PageGeometry {
  if (!Number.isFinite(widthPt) || !Number.isFinite(heightPt) || widthPt <= 0 || heightPt <= 0) {
    throw new ConversionError('PDF_LOAD_FAILED', 'The PDF page size is invalid.');
  }

  const widthIn = widthPt / 72;
  const heightIn = heightPt / 72;
  const scale = ppi / 72;
  const pixelWidth = Math.ceil(widthPt * scale);
  const pixelHeight = Math.ceil(heightPt * scale);
  const pixels = pixelWidth * pixelHeight;

  if (
    pixelWidth > MAX_CANVAS_SIDE ||
    pixelHeight > MAX_CANVAS_SIDE ||
    pixels > MAX_PIXELS_PER_PAGE
  ) {
    throw new ConversionError(
      'PIXEL_LIMIT',
      `One page at ${ppi} PPI needs ${formatPixels(pixels)}, which exceeds the browser safety limit. Lower the PPI.`,
    );
  }

  return { widthPt, heightPt, widthIn, heightIn, pixelWidth, pixelHeight, pixels };
}

export function createPixelEstimate(
  widthPt: number,
  heightPt: number,
  ppi: number,
  pageCount: number,
): PixelEstimate {
  const geometry = calculatePageGeometry(widthPt, heightPt, ppi);
  const totalPixels = geometry.pixels * pageCount;
  if (totalPixels > MAX_TOTAL_PIXELS) {
    throw new ConversionError(
      'PIXEL_LIMIT',
      `The estimated total of ${formatPixels(totalPixels)} exceeds the browser safety limit. Lower the PPI or use fewer pages.`,
    );
  }

  return {
    ...geometry,
    pageCount,
    totalPixels,
    // This is the live Canvas RGBA lower-bound estimate, not a PNG file-size prediction.
    rawMemoryBytes: totalPixels * 4,
  };
}

export function validateFileSize(file: File): void {
  if (file.size <= 0) {
    throw new ConversionError('INVALID_FILE', 'Please choose a non-empty PDF file.');
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new ConversionError(
      'FILE_TOO_LARGE',
      `PDF files must be ${formatBytes(MAX_FILE_BYTES)} or smaller.`,
    );
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  for (const unit of units) {
    if (value < 1024 || unit === units.at(-1)) return `${value.toFixed(value >= 100 ? 0 : 1)} ${unit}`;
    value /= 1024;
  }
  return `${bytes} B`;
}

export function formatPixels(pixels: number): string {
  if (pixels < 1_000_000) return `${Math.round(pixels / 1000)} K`;
  return `${(pixels / 1_000_000).toFixed(pixels >= 100_000_000 ? 0 : 1)} MP`;
}

export function formatDimensions(width: number, height: number): string {
  return `${width.toLocaleString('en-US')} × ${height.toLocaleString('en-US')} px`;
}

export function makeOutputFileName(fileName: string, ppi: number): string {
  const withoutExtension = fileName.replace(/\.[^/.]+$/, '');
  const normalized = withoutExtension
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-_.]+|[-_.]+$/g, '')
    .slice(0, 100);
  return `${normalized || 'beamer-presentation'}-${ppi}ppi.pptx`;
}

export function isSamePageSize(
  widthPt: number,
  heightPt: number,
  reference: Pick<PageGeometry, 'widthPt' | 'heightPt'>,
): boolean {
  return (
    Math.abs(widthPt - reference.widthPt) <= PAGE_SIZE_TOLERANCE_PT &&
    Math.abs(heightPt - reference.heightPt) <= PAGE_SIZE_TOLERANCE_PT
  );
}
