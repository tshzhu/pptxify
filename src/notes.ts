export class NotesValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotesValidationError';
  }
}

export type FrameNotes = ReadonlyMap<number, string>;

type NoteSection = {
  frame: number;
  body: string[];
};

const frameHeadingPattern = /^\s*##\s+frame:\s*(\d+)\s*$/i;
const frameHeadingPrefixPattern = /^\s*##\s+frame\s*:/i;

/**
 * Parse the small Markdown dialect used by the notes editor.
 *
 * Every frame section starts with `## frame: N`; its body continues until the
 * next frame heading. Markdown inside the body is intentionally preserved as
 * text because PowerPoint speaker notes are plain text, not rendered slides.
 */
export function parseFrameNotes(markdown: string, pageCount: number): Map<number, string> {
  if (!Number.isInteger(pageCount) || pageCount < 1) {
    throw new NotesValidationError('The PDF page count is invalid.');
  }

  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const sections: NoteSection[] = [];
  let current: NoteSection | null = null;
  const preamble: string[] = [];

  for (const line of lines) {
    if (frameHeadingPrefixPattern.test(line)) {
      const match = frameHeadingPattern.exec(line);
      if (!match) {
        throw new NotesValidationError(`Invalid frame heading: "${line.trim()}". Use "## frame: 1".`);
      }

      const frame = Number(match[1]);
      if (frame < 1 || frame > pageCount) {
        throw new NotesValidationError(`Frame ${frame} is outside the PDF page range 1–${pageCount}.`);
      }
      if (sections.some((section) => section.frame === frame)) {
        throw new NotesValidationError(`Frame ${frame} is listed more than once.`);
      }

      current = { frame, body: [] };
      sections.push(current);
      continue;
    }

    if (current) current.body.push(line);
    else preamble.push(line);
  }

  if (sections.length === 0) {
    if (preamble.join('\n').trim()) {
      throw new NotesValidationError('Add a frame heading before each note, for example "## frame: 1".');
    }
    return new Map();
  }

  if (preamble.join('\n').trim()) {
    throw new NotesValidationError('Text before the first frame heading is not allowed.');
  }

  const result = new Map<number, string>();
  for (const section of sections) {
    const body = section.body.join('\n').trim();
    if (!body) {
      throw new NotesValidationError(`Frame ${section.frame} has an empty note.`);
    }
    result.set(section.frame, body);
  }
  return result;
}
