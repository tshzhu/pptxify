export class NotesValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotesValidationError';
  }
}

export type PageNotes = ReadonlyMap<number, string>;

type NoteSection = {
  page: number;
  body: string[];
};

const pageHeadingPattern = /^\s*##\s+page:\s*(\d+)\s*$/i;
const pageHeadingPrefixPattern = /^\s*##\s+page\s*:/i;

/**
 * Parse the small Markdown dialect used by the notes editor.
 *
 * Every page section starts with `## page: N`; its body continues until the
 * next page heading. Markdown inside the body is intentionally preserved as
 * text because PowerPoint speaker notes are plain text, not rendered slides.
 */
export function parsePageNotes(markdown: string, pageCount: number): Map<number, string> {
  if (!Number.isInteger(pageCount) || pageCount < 1) {
    throw new NotesValidationError('The PDF page count is invalid.');
  }

  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const sections: NoteSection[] = [];
  let current: NoteSection | null = null;
  const preamble: string[] = [];

  for (const line of lines) {
    if (pageHeadingPrefixPattern.test(line)) {
      const match = pageHeadingPattern.exec(line);
      if (!match) {
        throw new NotesValidationError(`Invalid page heading: "${line.trim()}". Use "## page: 1".`);
      }

      const page = Number(match[1]);
      if (page < 1 || page > pageCount) {
        throw new NotesValidationError(`Page ${page} is outside the PDF page range 1–${pageCount}.`);
      }
      if (sections.some((section) => section.page === page)) {
        throw new NotesValidationError(`Page ${page} is listed more than once.`);
      }

      current = { page, body: [] };
      sections.push(current);
      continue;
    }

    if (current) current.body.push(line);
    else preamble.push(line);
  }

  if (sections.length === 0) {
    if (preamble.join('\n').trim()) {
      throw new NotesValidationError('Add a page heading before each note, for example "## page: 1".');
    }
    return new Map();
  }

  if (preamble.join('\n').trim()) {
    throw new NotesValidationError('Text before the first page heading is not allowed.');
  }

  const result = new Map<number, string>();
  for (const section of sections) {
    const body = section.body.join('\n').trim();
    if (!body) {
      throw new NotesValidationError(`Page ${section.page} has an empty note.`);
    }
    result.set(section.page, body);
  }
  return result;
}
