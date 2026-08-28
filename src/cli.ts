#!/usr/bin/env node

import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, extname, join, parse, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createCanvas } from '@napi-rs/canvas';
import {
  getDocument,
  GlobalWorkerOptions,
  type PDFDocumentLoadingTask,
  type PDFDocumentProxy,
  type PDFPageProxy,
} from 'pdfjs-dist/legacy/build/pdf.mjs';
import PptxGenJS from 'pptxgenjs';

import {
  assertPdfSignature,
  estimateDocument,
  inspectPdfDocument,
  type DocumentInspection,
} from './core.js';
import {
  ConversionError,
  formatBytes,
  parsePpi,
  type PageGeometry,
} from './limits.js';
import { annotatePptxWithNotes } from './pptx-notes.js';
import { parsePageNotes } from './notes.js';

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PDFJS_ROOT = join(PACKAGE_ROOT, 'node_modules', 'pdfjs-dist');
const DEFAULT_PPI = 600;
const HELP = `Usage: pptxify <input.pdf> [options]

Convert a PDF presentation into an image-based PPTX locally.

Options:
  -p, --ppi <number>       Image PPI, an integer from 1 to 600 (default: 600)
  -o, --output <path>      Output .pptx path (default: <input>-<ppi>ppi.pptx)
      --notes <path>       Apply UTF-8 page notes from a .txt or .md file
  -q, --quiet              Suppress progress logs
  -h, --help               Show this help
  -v, --version            Show the package version

The CLI never overwrites the input PDF. Output files are written atomically.
Exit status is 0 only when the PPTX has been written successfully.
`;

type CliOptions = {
  inputPath: string;
  outputPath?: string;
  notesPath?: string;
  ppi: number;
  quiet: boolean;
};

type CanvasLike = ReturnType<typeof createCanvas>;

function log(message: string, quiet: boolean): void {
  if (!quiet) process.stderr.write(`${message}\n`);
}

function fail(message: string, code = 2): never {
  process.stderr.write(`pptxify: ${message}\n`);
  process.exit(code);
}

async function readPackageVersion(): Promise<string> {
  const packageJson = JSON.parse(await readFile(join(PACKAGE_ROOT, 'package.json'), 'utf8')) as { version?: string };
  return packageJson.version ?? 'unknown';
}

function parseArgs(argv: string[]): CliOptions {
  let inputPath = '';
  let outputPath: string | undefined;
  let notesPath: string | undefined;
  let ppi = DEFAULT_PPI;
  let quiet = false;

  const takeValue = (index: number, option: string): string => {
    const value = argv[index + 1];
    if (!value || value.startsWith('-')) fail(`${option} requires a value. Use --help for usage.`);
    return value;
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      process.stdout.write(HELP);
      process.exit(0);
    }
    if (arg === '--version' || arg === '-v') {
      // The async main prints the version when this sentinel is returned.
      return { inputPath: '__VERSION__', ppi, quiet };
    }
    if (arg === '--quiet' || arg === '-q') {
      quiet = true;
      continue;
    }
    if (arg === '--ppi' || arg === '-p') {
      try {
        ppi = parsePpi(takeValue(index, arg));
      } catch (error) {
        fail(error instanceof Error ? error.message : String(error));
      }
      index += 1;
      continue;
    }
    if (arg.startsWith('--ppi=')) {
      try {
        ppi = parsePpi(arg.slice('--ppi='.length));
      } catch (error) {
        fail(error instanceof Error ? error.message : String(error));
      }
      continue;
    }
    if (arg === '--output' || arg === '-o') {
      outputPath = takeValue(index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith('--output=')) {
      outputPath = arg.slice('--output='.length);
      if (!outputPath) fail('--output requires a value. Use --help for usage.');
      continue;
    }
    if (arg === '--notes') {
      notesPath = takeValue(index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith('--notes=')) {
      notesPath = arg.slice('--notes='.length);
      if (!notesPath) fail('--notes requires a value. Use --help for usage.');
      continue;
    }
    if (arg.startsWith('-')) fail(`Unknown option: ${arg}. Use --help for usage.`);
    if (inputPath) fail('Only one input PDF may be provided. Use --help for usage.');
    inputPath = arg;
  }

  if (!inputPath) fail('An input PDF is required. Use --help for usage.');
  return { inputPath, outputPath, notesPath, ppi, quiet };
}

function classifyPdfError(error: unknown): ConversionError {
  if (error instanceof ConversionError) return error;
  const message = error instanceof Error ? error.message : String(error);
  if (/password|encrypted/i.test(message)) {
    return new ConversionError('PASSWORD_PROTECTED', 'Password-protected PDFs are not supported.');
  }
  return new ConversionError('PDF_LOAD_FAILED', `Could not read the PDF: ${message || 'unknown error'}`, { cause: error });
}

async function createLoadingTask(data: Uint8Array): Promise<PDFDocumentLoadingTask> {
  const options = {
    data: new Uint8Array(data),
    useSystemFonts: true,
    standardFontDataUrl: pathToFileURL(join(PDFJS_ROOT, 'standard_fonts')).href + '/',
    cMapUrl: pathToFileURL(join(PDFJS_ROOT, 'cmaps')).href + '/',
    cMapPacked: true,
    iccUrl: pathToFileURL(join(PDFJS_ROOT, 'iccs')).href + '/',
    wasmUrl: pathToFileURL(join(PDFJS_ROOT, 'wasm')).href + '/',
    maxImageSize: -1,
  } as Parameters<typeof getDocument>[0];
  GlobalWorkerOptions.workerSrc = pathToFileURL(join(PDFJS_ROOT, 'legacy', 'build', 'pdf.worker.mjs')).href;
  return getDocument(options);
}

async function withPdf<T>(data: Uint8Array, callback: (pdf: PDFDocumentProxy) => Promise<T>): Promise<T> {
  const loadingTask = await createLoadingTask(data);
  let pdf: PDFDocumentProxy | undefined;
  try {
    pdf = await loadingTask.promise;
    return await callback(pdf);
  } catch (error) {
    throw classifyPdfError(error);
  } finally {
    try {
      await pdf?.cleanup();
    } catch {
      // Destruction below still runs when cleanup cannot release a page cache.
    }
    try {
      await loadingTask.destroy();
    } catch {
      // Preserve the conversion error if worker destruction also fails.
    }
  }
}

function canvasToPng(canvas: CanvasLike & { toBuffer(mime: 'image/png'): Buffer }): Uint8Array {
  return new Uint8Array(canvas.toBuffer('image/png'));
}

async function renderPageToPng(page: PDFPageProxy, geometry: PageGeometry): Promise<Uint8Array> {
  const scale = geometry.pixelWidth / geometry.widthPt;
  const viewport = page.getViewport({ scale });
  const canvas = createCanvas(geometry.pixelWidth, geometry.pixelHeight) as unknown as CanvasLike & {
    toBuffer(mime: 'image/png'): Buffer;
  };
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({
    canvas: canvas as unknown as HTMLCanvasElement,
    canvasContext: context as unknown as CanvasRenderingContext2D,
    viewport,
    intent: 'print',
  }).promise;
  const image = canvasToPng(canvas);
  canvas.width = 1;
  canvas.height = 1;
  return image;
}

function dataUrlFromPng(png: Uint8Array): string {
  return `data:image/png;base64,${Buffer.from(png).toString('base64')}`;
}

function defaultOutputPath(inputPath: string, ppi: number): string {
  const parsed = parse(inputPath);
  const extension = extname(parsed.base);
  const stem = extension.toLowerCase() === '.pdf' ? parsed.base.slice(0, -extension.length) : parsed.base;
  return join(parsed.dir, `${stem}-${ppi}ppi.pptx`);
}

async function buildPptx(
  data: Uint8Array,
  ppi: number,
  quiet: boolean,
): Promise<{ output: Uint8Array; inspection: DocumentInspection }> {
  return withPdf(data, async (pdf) => {
    const inspection = await inspectPdfDocument(pdf, undefined, (_current, _total, detail) => {
      log(detail, quiet);
    });
    const estimate = estimateDocument(inspection, ppi);
    const Pptx = PptxGenJS as unknown as new () => {
      defineLayout(layout: { name: string; width: number; height: number }): void;
      layout: string;
      author: string;
      company: string;
      subject: string;
      title: string;
      addSlide(): {
        background: { color: string };
        addImage(options: Record<string, unknown>): void;
        addNotes(notes: string): void;
      };
      write(options: { outputType: 'nodebuffer'; compression: boolean }): Promise<Buffer>;
    };
    const pptx = new Pptx();
    const layoutName = 'PDF_CUSTOM';
    pptx.defineLayout({ name: layoutName, width: estimate.widthIn, height: estimate.heightIn });
    pptx.layout = layoutName;
    pptx.author = 'pptxify';
    pptx.company = 'pptxify';
    pptx.subject = `Rasterized at ${ppi} PPI`;
    pptx.title = 'PDF presentation';

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      try {
        log(`Rendering page ${pageNumber}/${pdf.numPages}…`, quiet);
        const png = await renderPageToPng(page, estimate);
        const slide = pptx.addSlide();
        slide.background = { color: 'FFFFFF' };
        slide.addImage({
          data: dataUrlFromPng(png),
          x: 0,
          y: 0,
          w: estimate.widthIn,
          h: estimate.heightIn,
          altText: `PDF page ${pageNumber}`,
          objectName: `PDF page ${pageNumber}`,
        });
        slide.addNotes('');
      } finally {
        await page.cleanup();
      }
    }
    const output = await pptx.write({ outputType: 'nodebuffer', compression: true });
    return { output: new Uint8Array(output as Buffer), inspection };
  });
}

async function writeAtomically(path: string, data: Uint8Array): Promise<void> {
  const target = resolve(path);
  await mkdir(dirname(target), { recursive: true });
  const temporary = join(dirname(target), `.${target.split('/').pop()}.tmp-${process.pid}-${Date.now()}`);
  try {
    await writeFile(temporary, data);
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

async function applyNotesFile(base: Uint8Array, notesPath: string, pageCount: number): Promise<Uint8Array> {
  const extension = extname(notesPath).toLowerCase();
  if (extension !== '.txt' && extension !== '.md') {
    throw new ConversionError('PPTX_FAILED', 'The --notes file must use the .txt or .md extension.');
  }
  let markdown: string;
  try {
    markdown = await readFile(resolve(notesPath), 'utf8');
  } catch (error) {
    throw new ConversionError(
      'PPTX_FAILED',
      `Could not read notes file ${resolve(notesPath)}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  const notes = parsePageNotes(markdown, pageCount);
  const annotated = await annotatePptxWithNotes(Buffer.from(base), notes);
  return new Uint8Array(await annotated.arrayBuffer());
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.inputPath === '__VERSION__') {
    process.stdout.write(`${await readPackageVersion()}\n`);
    return;
  }
  const inputPath = resolve(options.inputPath);
  let data: Uint8Array;
  try {
    data = new Uint8Array(await readFile(inputPath));
  } catch (error) {
    throw new ConversionError(
      'INVALID_FILE',
      `Could not read input PDF ${inputPath}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  await assertPdfSignature(new Blob([new Uint8Array(data)]));
  const outputPath = resolve(options.outputPath ?? defaultOutputPath(inputPath, options.ppi));
  if (outputPath === inputPath) {
    fail('The output path must be different from the input PDF.');
  }
  log(`Reading ${inputPath} (${formatBytes(data.byteLength)})…`, options.quiet);
  const result = await buildPptx(data, options.ppi, options.quiet);
  let output = result.output;
  if (options.notesPath) {
    output = await applyNotesFile(result.output, options.notesPath, result.inspection.pageCount);
  }
  try {
    await writeAtomically(outputPath, output);
  } catch (error) {
    throw new ConversionError(
      'PPTX_FAILED',
      `Could not write output PPTX ${outputPath}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  process.stdout.write(`Wrote ${outputPath} (${formatBytes(output.byteLength)})\n`);
}

main().catch((error: unknown) => {
  const classified = error instanceof ConversionError ? error : classifyPdfError(error);
  process.stderr.write(`pptxify: ${classified.message}\n`);
  process.exitCode = 1;
});
