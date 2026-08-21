import './styles.css';

import {
  ConversionError,
  DEFAULT_PPI,
  createPixelEstimate,
  formatBytes,
  parsePpi,
  type PixelEstimate,
} from './limits';
import {
  convertPdfToPptx,
  inspectPdfFile,
  type ConversionProgress,
  type PdfInspection,
} from './converter';
import { parseFrameNotes, type FrameNotes } from './notes';
import { annotatePptxWithNotes, extractFrameNotesFromPptx } from './pptx-notes';
import { GITHUB_REPOSITORY_URL } from './site-config';

type ElementMap = {
  dropZone: HTMLDivElement;
  fileInput: HTMLInputElement;
  chooseFile: HTMLButtonElement;
  replaceFile: HTMLButtonElement;
  fileSummary: HTMLDivElement;
  fileName: HTMLDivElement;
  fileMeta: HTMLDivElement;
  ppiInput: HTMLInputElement;
  convertButton: HTMLButtonElement;
  downloadButton: HTMLButtonElement;
  notesButton: HTMLButtonElement;
  cancelButton: HTMLButtonElement;
  resetButton: HTMLButtonElement;
  notesPanel: HTMLDivElement;
  notesInput: HTMLTextAreaElement;
  notesFileError: HTMLDivElement;
  applyNotesButton: HTMLButtonElement;
  cancelNotesButton: HTMLButtonElement;
  statusPanel: HTMLDivElement;
  statusLabel: HTMLSpanElement;
  statusPercent: HTMLSpanElement;
  progressTrack: HTMLDivElement;
  progressBar: HTMLDivElement;
  statusDetail: HTMLDivElement;
  message: HTMLDivElement;
  githubLink: HTMLAnchorElement;
  presets: HTMLButtonElement[];
};

const elements = getElements();
let currentFile: File | null = null;
let currentInspection: PdfInspection | null = null;
let currentEstimate: PixelEstimate | null = null;
let baseOutputBlob: Blob | null = null;
let outputBlob: Blob | null = null;
let outputFileName = '';
let outputUrl: string | null = null;
let inspectionController: AbortController | null = null;
let conversionController: AbortController | null = null;
let annotationController: AbortController | null = null;
let isBusy = false;

initialize();

function getElements(): ElementMap {
  const get = <T extends HTMLElement>(id: string): T => {
    const element = document.getElementById(id);
    if (!element) throw new Error(`Missing required element #${id}`);
    return element as T;
  };

  return {
    dropZone: get<HTMLDivElement>('drop-zone'),
    fileInput: get<HTMLInputElement>('file-input'),
    chooseFile: get<HTMLButtonElement>('choose-file'),
    replaceFile: get<HTMLButtonElement>('replace-file'),
    fileSummary: get<HTMLDivElement>('file-summary'),
    fileName: get<HTMLDivElement>('file-name'),
    fileMeta: get<HTMLDivElement>('file-meta'),
    ppiInput: get<HTMLInputElement>('ppi-input'),
    convertButton: get<HTMLButtonElement>('convert-button'),
    downloadButton: get<HTMLButtonElement>('download-button'),
    notesButton: get<HTMLButtonElement>('notes-button'),
    cancelButton: get<HTMLButtonElement>('cancel-button'),
    resetButton: get<HTMLButtonElement>('reset-button'),
    notesPanel: get<HTMLDivElement>('notes-panel'),
    notesInput: get<HTMLTextAreaElement>('notes-input'),
    notesFileError: get<HTMLDivElement>('notes-file-error'),
    applyNotesButton: get<HTMLButtonElement>('apply-notes-button'),
    cancelNotesButton: get<HTMLButtonElement>('cancel-notes-button'),
    statusPanel: get<HTMLDivElement>('status-panel'),
    statusLabel: get<HTMLSpanElement>('status-label'),
    statusPercent: get<HTMLSpanElement>('status-percent'),
    progressTrack: get<HTMLDivElement>('progress-track'),
    progressBar: get<HTMLDivElement>('progress-bar'),
    statusDetail: get<HTMLDivElement>('status-detail'),
    message: get<HTMLDivElement>('message'),
    githubLink: get<HTMLAnchorElement>('github-link'),
    presets: Array.from(document.querySelectorAll<HTMLButtonElement>('[data-ppi]')),
  };
}

function initialize(): void {
  elements.githubLink.href = GITHUB_REPOSITORY_URL;
  elements.chooseFile.addEventListener('click', () => elements.fileInput.click());
  elements.replaceFile.addEventListener('click', () => elements.fileInput.click());
  elements.fileInput.addEventListener('change', () => {
    const [file] = Array.from(elements.fileInput.files ?? []);
    if (file) void handleFile(file);
  });

  elements.dropZone.addEventListener('click', (event) => {
    if (event.target instanceof HTMLButtonElement) return;
    elements.fileInput.click();
  });
  elements.dropZone.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      elements.fileInput.click();
    }
  });
  elements.dropZone.addEventListener('dragover', (event) => {
    event.preventDefault();
    if (!isBusy) elements.dropZone.classList.add('dragging');
  });
  elements.dropZone.addEventListener('dragleave', () => elements.dropZone.classList.remove('dragging'));
  elements.dropZone.addEventListener('drop', (event) => {
    event.preventDefault();
    elements.dropZone.classList.remove('dragging');
    if (isBusy) return;
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.length !== 1) {
      showMessage('Please choose one PDF file at a time.', 'error');
      return;
    }
    void handleFile(files[0]);
  });

  elements.ppiInput.addEventListener('input', () => {
    updatePpi(Number(elements.ppiInput.value));
  });
  for (const preset of elements.presets) {
    preset.addEventListener('click', () => {
      const ppi = Number(preset.dataset.ppi);
      elements.ppiInput.value = String(ppi);
      updatePpi(ppi);
    });
  }

  elements.convertButton.addEventListener('click', () => void startConversion());
  elements.downloadButton.addEventListener('click', () => downloadOutput());
  elements.notesButton.addEventListener('click', () => toggleNotesPanel());
  elements.applyNotesButton.addEventListener('click', () => void applyNotes());
  elements.cancelNotesButton.addEventListener('click', () => hideNotesPanel());
  elements.notesInput.addEventListener('input', () => clearNotesFileError());
  elements.notesInput.addEventListener('dragenter', (event) => {
    event.preventDefault();
    if (!isBusy) elements.notesInput.classList.add('file-drop-active');
  });
  elements.notesInput.addEventListener('dragover', (event) => {
    event.preventDefault();
    if (!isBusy) {
      elements.notesInput.classList.add('file-drop-active');
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    }
  });
  elements.notesInput.addEventListener('dragleave', () => elements.notesInput.classList.remove('file-drop-active'));
  elements.notesInput.addEventListener('drop', (event) => {
    event.preventDefault();
    elements.notesInput.classList.remove('file-drop-active');
    if (isBusy) return;
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.length !== 1) {
      showNotesFileError('Drop one .txt, .md, or .pptx file at a time.');
      return;
    }
    void importNotesFile(files[0]);
  });
  elements.cancelButton.addEventListener('click', () => cancelConversion());
  elements.resetButton.addEventListener('click', () => reset());
  window.addEventListener('beforeunload', () => releaseOutput());

  updatePpi(DEFAULT_PPI, false);
  updateControls();
}

async function handleFile(file: File): Promise<void> {
  if (isBusy) return;
  abortInspection();
  releaseOutput();
  hideNotesPanel();
  elements.notesInput.value = '';
  clearMessage();
  currentFile = file;
  currentInspection = null;
  currentEstimate = null;
  elements.fileSummary.classList.remove('hidden');
  elements.fileName.textContent = file.name;
  elements.fileMeta.textContent = `${formatBytes(file.size)} · Inspecting pages…`;
  elements.fileInput.value = '';
  updateControls();

  const controller = new AbortController();
  inspectionController = controller;
  try {
    const inspection = await inspectPdfFile(file, getPpi(), controller.signal);
    if (controller.signal.aborted || currentFile !== file) return;
    currentInspection = inspection;
    currentEstimate = inspection;
    elements.fileMeta.textContent = `${formatBytes(file.size)} · ${inspection.pageCount} pages · ${formatPageSize(inspection)}`;
    clearMessage();
  } catch (error) {
    if (controller.signal.aborted || currentFile !== file) return;
    currentInspection = null;
    currentEstimate = null;
    elements.fileMeta.textContent = `${formatBytes(file.size)} · Unable to read`;
    showMessage(formatError(error), 'error');
  } finally {
    if (inspectionController === controller) inspectionController = null;
    updateControls();
  }
}

function updatePpi(value: number, announce = true): void {
  for (const preset of elements.presets) {
    preset.classList.toggle('active', Number(preset.dataset.ppi) === value);
  }

  try {
    parsePpi(value);
    elements.ppiInput.setCustomValidity('');
    if (currentInspection) {
      currentEstimate = createPixelEstimate(
        currentInspection.widthPt,
        currentInspection.heightPt,
        value,
        currentInspection.pageCount,
      );
      if (announce) clearMessage();
    }
  } catch (error) {
    currentEstimate = null;
    elements.ppiInput.setCustomValidity(formatError(error));
    if (currentInspection) {
      if (announce) showMessage(formatError(error), 'error');
    }
  }
  updateControls();
}

async function startConversion(): Promise<void> {
  if (isBusy || !currentFile || !currentEstimate) return;
  clearMessage();
  releaseOutput();
  isBusy = true;
  conversionController = new AbortController();
  updateControls();
  showProgress({ stage: 'loading', current: 0, total: 1, percent: 0, detail: 'Loading PDF…' });

  try {
    const result = await convertPdfToPptx(currentFile, {
      ppi: getPpi(),
      signal: conversionController.signal,
      onProgress: showProgress,
    });
    if (conversionController.signal.aborted) return;
    baseOutputBlob = result.outputBlob;
    outputFileName = result.outputFileName;
    elements.notesButton.textContent = 'Add notes';
    setDownloadBlob(result.outputBlob);
    showProgress({ stage: 'packaging', current: result.pageCount, total: result.pageCount, percent: 100, detail: 'PPTX is ready to download.' });
    showMessage(`Conversion complete: ${result.pageCount} pages, ${formatBytes(result.outputBlob.size)}.`, 'success');
    elements.downloadButton.classList.remove('hidden');
    elements.notesButton.classList.remove('hidden');
    elements.resetButton.classList.remove('hidden');
  } catch (error) {
    if (conversionController?.signal.aborted || isCancellation(error)) {
      showMessage('Conversion cancelled.', 'notice');
      hideProgress();
    } else {
      showMessage(formatError(error), 'error');
      setProgressError();
    }
  } finally {
    isBusy = false;
    conversionController = null;
    updateControls();
  }
}

function toggleNotesPanel(): void {
  if (elements.notesPanel.classList.contains('hidden')) {
    elements.notesPanel.classList.remove('hidden');
    elements.notesInput.focus();
  } else {
    hideNotesPanel();
  }
}

function hideNotesPanel(): void {
  elements.notesPanel.classList.add('hidden');
  clearNotesFileError();
}

async function importNotesFile(file: File): Promise<void> {
  const extension = file.name.toLowerCase().split('.').pop() ?? '';
  try {
    if (extension === 'txt' || extension === 'md') {
      elements.notesInput.value = await file.text();
    } else if (extension === 'pptx') {
      elements.notesInput.value = await extractFrameNotesFromPptx(file);
    } else if (extension === 'ppt') {
      throw new Error('PPT files are not supported. Drop a .pptx file instead.');
    } else {
      throw new Error('Unsupported file type. Drop a .txt, .md, or .pptx file.');
    }
    clearNotesFileError();
  } catch (error) {
    showNotesFileError(formatError(error));
  }
}

function showNotesFileError(text: string): void {
  elements.notesFileError.textContent = text;
  elements.notesFileError.className = 'notes-file-error';
}

function clearNotesFileError(): void {
  elements.notesFileError.textContent = '';
  elements.notesFileError.className = 'notes-file-error hidden';
}

async function applyNotes(): Promise<void> {
  if (isBusy || !baseOutputBlob || !currentInspection) return;

  let notes: FrameNotes;
  try {
    notes = parseFrameNotes(elements.notesInput.value, currentInspection.pageCount);
  } catch (error) {
    showMessage(formatError(error), 'error');
    return;
  }

  clearMessage();
  isBusy = true;
  annotationController = new AbortController();
  updateControls();
  showProgress({ stage: 'annotating', current: 0, total: 1, percent: 0, detail: 'Preparing slide notes…' });

  try {
    const annotatedBlob = notes.size === 0
      ? baseOutputBlob
      : await annotatePptxWithNotes(baseOutputBlob, notes, annotationController.signal);
    if (annotationController.signal.aborted) return;
    setDownloadBlob(annotatedBlob);
    showProgress({ stage: 'annotating', current: 1, total: 1, percent: 100, detail: notes.size === 0 ? 'Notes cleared.' : 'Slide notes are ready.' });
    showMessage(notes.size === 0 ? 'Notes cleared. The unannotated PPTX is ready.' : `Notes added to ${notes.size} page${notes.size === 1 ? '' : 's'}.`, 'success');
    elements.notesButton.textContent = notes.size === 0 ? 'Add notes' : 'Edit notes';
    hideNotesPanel();
  } catch (error) {
    if (annotationController?.signal.aborted) {
      showMessage('Adding notes cancelled.', 'notice');
      hideProgress();
    } else {
      showMessage(formatError(error), 'error');
      setProgressError('Notes failed', 'Fix the notes format and try again.');
    }
  } finally {
    isBusy = false;
    annotationController = null;
    updateControls();
  }
}

function cancelConversion(): void {
  conversionController?.abort();
  inspectionController?.abort();
  annotationController?.abort();
}

function reset(): void {
  if (isBusy) return;
  abortInspection();
  releaseOutput();
  currentFile = null;
  currentInspection = null;
  currentEstimate = null;
  elements.fileInput.value = '';
  elements.fileSummary.classList.add('hidden');
  elements.fileName.textContent = '';
  elements.fileMeta.textContent = '';
  clearMessage();
  hideProgress();
  hideNotesPanel();
  elements.notesInput.value = '';
  elements.resetButton.classList.add('hidden');
  elements.downloadButton.classList.add('hidden');
  updateControls();
}

function updateControls(): void {
  const validPpi = isValidPpi();
  elements.convertButton.disabled = isBusy || !currentFile || !currentEstimate || !validPpi;
  elements.chooseFile.disabled = isBusy;
  elements.replaceFile.disabled = isBusy;
  elements.ppiInput.disabled = isBusy;
  for (const preset of elements.presets) preset.disabled = isBusy;
  elements.notesButton.disabled = isBusy;
  elements.applyNotesButton.disabled = isBusy;
  elements.cancelNotesButton.disabled = isBusy;
  elements.cancelButton.classList.toggle('hidden', !isBusy);
  elements.notesButton.classList.toggle('hidden', !baseOutputBlob);
  elements.convertButton.classList.toggle('hidden', Boolean(outputBlob));
  elements.dropZone.classList.toggle('disabled', isBusy);
}

function showProgress(progress: ConversionProgress): void {
  elements.statusPanel.classList.remove('hidden');
  elements.statusLabel.textContent = stageLabel(progress.stage);
  const percent = Math.max(0, Math.min(100, Math.round(progress.percent)));
  elements.statusPercent.textContent = `${percent}%`;
  elements.progressBar.style.width = `${percent}%`;
  elements.progressTrack.setAttribute('aria-valuenow', String(percent));
  elements.statusDetail.textContent = progress.detail;
  elements.statusPanel.classList.remove('status-error');
}

function setProgressError(label = 'Conversion failed', detail = 'Adjust the file or PPI above and try again.'): void {
  elements.statusPanel.classList.remove('hidden');
  elements.statusPanel.classList.add('status-error');
  elements.statusLabel.textContent = label;
  elements.statusPercent.textContent = '—';
  elements.statusDetail.textContent = detail;
}

function hideProgress(): void {
  elements.statusPanel.classList.add('hidden');
  elements.statusPanel.classList.remove('status-error');
  elements.progressBar.style.width = '0%';
  elements.progressTrack.setAttribute('aria-valuenow', '0');
}

function showMessage(text: string, kind: 'error' | 'success' | 'notice'): void {
  elements.message.textContent = text;
  elements.message.className = `message message-${kind}`;
}

function clearMessage(): void {
  elements.message.textContent = '';
  elements.message.className = 'message hidden';
}

function downloadOutput(): void {
  if (!outputUrl || !outputFileName) return;
  const anchor = document.createElement('a');
  anchor.href = outputUrl;
  anchor.download = outputFileName;
  anchor.click();
}

function setDownloadBlob(blob: Blob): void {
  if (outputUrl) URL.revokeObjectURL(outputUrl);
  outputBlob = blob;
  outputUrl = URL.createObjectURL(blob);
}

function releaseOutput(): void {
  if (outputUrl) URL.revokeObjectURL(outputUrl);
  outputUrl = null;
  outputBlob = null;
  baseOutputBlob = null;
  outputFileName = '';
}

function abortInspection(): void {
  inspectionController?.abort();
  inspectionController = null;
}

function isValidPpi(): boolean {
  try {
    parsePpi(getPpi());
    return true;
  } catch {
    return false;
  }
}

function getPpi(): number {
  return Number(elements.ppiInput.value);
}

function formatPageSize(inspection: Pick<PdfInspection, 'widthIn' | 'heightIn'>): string {
  return `${inspection.widthIn.toFixed(2)} × ${inspection.heightIn.toFixed(2)} in`;
}

function stageLabel(stage: ConversionProgress['stage']): string {
  switch (stage) {
    case 'loading': return 'Loading PDF';
    case 'inspecting': return 'Inspecting pages';
    case 'rendering': return 'Rendering pages';
    case 'packaging': return 'Packaging PPTX';
    case 'annotating': return 'Adding notes';
  }
}

function formatError(error: unknown): string {
  if (error instanceof ConversionError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return 'Conversion failed. Check the PDF and try again.';
}

function isCancellation(error: unknown): boolean {
  return error instanceof ConversionError && error.code === 'CANCELLED';
}
