# pptxify

**pptxify** converts PDF presentations into high-quality, image-based PowerPoint
files entirely in your browser. It is designed for LaTeX Beamer slides, but it
works with any standard PDF.

[Open pptxify](https://tshzhu.github.io/pptxify/)

## Features

- Converts every PDF page into a full-slide PNG image.
- Preserves the PDF page dimensions in the generated PPTX.
- Supports configurable image density from 1 to 1200 PPI, with 600 PPI as the
  default.
- Adds optional PowerPoint speaker notes using page-based Markdown.
- Imports notes from `.txt`, `.md`, or existing `.pptx` files by dropping the
  file onto the notes editor.
- Processes the PDF and creates the PPTX locally in the browser. No document is
  uploaded to a server.

## Usage

1. Open the [pptxify website](https://tshzhu.github.io/pptxify/).
2. Choose a PDF or drop it onto the upload area.
3. Select the image PPI. Higher values improve raster resolution but require
   more memory and produce larger files.
4. Click **Convert to PPTX**.
5. Optionally add speaker notes.
6. Click **Download PPTX**.

### Speaker notes

After conversion, click **Add notes** and enter one Markdown section for each
PDF page that needs a note:

```markdown
## page: 1
Opening note

## page: 3
Note for the third page
```

Page numbers are 1-based PDF page numbers. The editor rejects duplicate,
malformed, empty, or out-of-range page sections.

You can also drop a `.txt`, `.md`, or `.pptx` file directly onto the notes
textarea. Text and Markdown files are copied as-is. For a PPTX file, pptxify
extracts non-empty speaker notes and converts them into page-based Markdown.
Legacy `.ppt` files are not supported.

## Output and limitations

Each output slide contains one full-page raster image. This approach preserves
fonts, equations, vector artwork, and Beamer styling visually without requiring
LaTeX or PowerPoint on the server. Slide contents, hyperlinks, animations, and
PDF text are flattened and are not editable PowerPoint objects.

The application accepts PDFs up to 100 MB and 120 pages. It also applies
per-page and total-pixel safety limits to avoid exhausting browser memory. Lower
the PPI or split a large PDF when a safety limit is reached.

## Local development

Node.js 22 or newer is required.

```bash
npm ci
npm run dev
```

Run the validation and production build with:

```bash
npm run check
npm run build
npm run preview
```

The application has no backend. GitHub Actions builds the static Vite site and
deploys `dist/` to GitHub Pages whenever `main` is updated.

## Technology

- [PDF.js](https://mozilla.github.io/pdf.js/) renders PDF pages in the browser.
- [PptxGenJS](https://gitbrent.github.io/PptxGenJS/) creates the PowerPoint file.
- [JSZip](https://stuk.github.io/jszip/) reads and updates PPTX speaker notes.
- [Vite](https://vite.dev/) builds the static website.

## License

This project is licensed under the [MIT License](LICENSE).
