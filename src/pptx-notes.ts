import JSZip from 'jszip';

import { NotesValidationError, type PageNotes } from './notes';

const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const PRESENTATION_NS = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const DRAWING_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main';

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function makeNotesTextBody(note: string): string {
  return `<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" dirty="0"/><a:t>${escapeXml(note)}</a:t></a:r><a:endParaRPr lang="en-US" dirty="0"/></a:p></p:txBody>`;
}

function replaceNotesText(xml: string, note: string): string {
  const bodyPattern = /(<p:ph type="body" idx="1"\/>[\s\S]*?<p:spPr\/>)<p:txBody>[\s\S]*?<\/p:txBody>/;
  if (!bodyPattern.test(xml)) {
    throw new NotesValidationError('The PPTX notes structure is missing or unsupported.');
  }
  return xml.replace(bodyPattern, (_match, prefix: string) => `${prefix}${makeNotesTextBody(note)}`);
}

/**
 * Patch speaker-note XML in a cached PptxGenJS output without touching slide
 * images or rerendering the PDF.
 */
export async function annotatePptxWithNotes(
  baseBlob: Blob,
  notes: PageNotes,
  signal?: AbortSignal,
): Promise<Blob> {
  if (signal?.aborted) throw new NotesValidationError('Adding notes was cancelled.');

  const zip = await JSZip.loadAsync(baseBlob);
  for (const [page, note] of notes) {
    if (signal?.aborted) throw new NotesValidationError('Adding notes was cancelled.');
    const path = `ppt/notesSlides/notesSlide${page}.xml`;
    const entry = zip.file(path);
    if (!entry) {
      throw new NotesValidationError(`The PPTX is missing the notes container for page ${page}.`);
    }
    const xml = await entry.async('string');
    zip.file(path, replaceNotesText(xml, note));
  }

  if (signal?.aborted) throw new NotesValidationError('Adding notes was cancelled.');
  return zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    mimeType: PPTX_MIME,
  });
}

function parseNotesXml(xml: string): string {
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  if (document.getElementsByTagName('parsererror').length > 0) {
    throw new NotesValidationError('The PPTX contains malformed notes XML.');
  }

  const shapes = Array.from(document.getElementsByTagNameNS(PRESENTATION_NS, 'sp'));
  const bodyShape = shapes.find((shape) => Array.from(
    shape.getElementsByTagNameNS(PRESENTATION_NS, 'ph'),
  ).some((placeholder) => placeholder.getAttribute('type') === 'body'));
  if (!bodyShape) {
    throw new NotesValidationError('The PPTX notes structure is missing or unsupported.');
  }

  const paragraphs = Array.from(bodyShape.getElementsByTagNameNS(DRAWING_NS, 'p'));
  return paragraphs
    .map((paragraph) => Array.from(paragraph.getElementsByTagNameNS(DRAWING_NS, 't'))
      .map((text) => text.textContent ?? '')
      .join(''))
    .join('\n')
    .trim();
}

/** Extract non-empty PowerPoint speaker notes and format them as page Markdown. */
export async function extractPageNotesFromPptx(file: Blob): Promise<string> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(file);
  } catch {
    throw new NotesValidationError('The dropped PPTX is corrupt or unreadable.');
  }

  if (!zip.file('[Content_Types].xml') || !zip.file('ppt/presentation.xml')) {
    throw new NotesValidationError('The dropped file is not a valid PPTX package.');
  }

  const noteEntries = Object.keys(zip.files)
    .map((path) => {
      const match = /^ppt\/notesSlides\/notesSlide(\d+)\.xml$/.exec(path);
      return match ? { path, page: Number(match[1]) } : null;
    })
    .filter((entry): entry is { path: string; page: number } => entry !== null)
    .sort((left, right) => left.page - right.page);

  const sections: string[] = [];
  for (const { path, page } of noteEntries) {
    const entry = zip.file(path);
    if (!entry) continue;
    let xml: string;
    try {
      xml = await entry.async('string');
    } catch {
      throw new NotesValidationError(`Could not read notes for page ${page}.`);
    }
    const note = parseNotesXml(xml);
    if (note) sections.push(`## page: ${page}\n${note}`);
  }
  return sections.join('\n\n');
}
