# PPTXify

Convert PDF presentations into high-quality, image-based PowerPoint files.
[Try it out](https://tshzhu.github.io/pptxify/).

```text
PDF → high-resolution PNG pages → image-based PPTX
```

PPTXify is designed for LaTeX Beamer presentations, but it also accepts standard
PDFs whose pages all use the same dimensions. The browser and CLI both process
files locally; no PDF, note, rendered image, or generated PPTX is uploaded.

There are two ways to use PPTXify:

- [In your browser](#browser)
- [From the command line](#cli)

## CLI

### Installation and usage

Node.js 22 or newer is required. The [`pptxify` npm package](https://www.npmjs.com/package/pptxify)
contains only the CLI build and its package metadata; it does not contain the
browser application or website assets.

Install the command globally:

```sh
npm install --global pptxify@latest
pptxify presentation.pdf
```

Run it once without a global install:

```sh
npx pptxify@latest presentation.pdf
```

Usage summary:

```text
pptxify <input.pdf> [options]
```

Exactly one input PDF is accepted. By default the CLI renders at **600 PPI** and
writes `<input-name>-600ppi.pptx` beside the PDF. Progress is written to stderr;
the final output path is written to stdout. The input is never replaced, and the
output is written atomically so a failed conversion does not replace an existing
file.

### Options

```text
-p, --ppi <number>
    Render at an integer PPI from 1 to 600. Default: 600.

-o, --output <path>
    Write the PPTX to this path instead of the default sibling path.

    --notes <path>
    Apply UTF-8 page notes from a .txt or .md file after rendering.

-q, --quiet
    Suppress progress logs. Fatal errors are still written to stderr.

-h, --help
    Show the complete command help.

-v, --version
    Show the CLI version.
```

Value options accept either `--option=value` or `--option value`.

### Page notes

The `--notes` file uses the same syntax as the browser editor:

```markdown
## page: 1
Opening note

## page: 4
Note for page four
```

Page numbers are 1-based. Only `## page: N` headings are supported. Empty notes,
duplicate or out-of-range pages, malformed headings, and text before the first
heading are rejected before the output is replaced. Applying notes patches the
generated PPTX without rendering the PDF a second time.

### Command examples

Choose a different resolution and output path:

```sh
pptxify slides.pdf --ppi 300 --output build/slides.pptx
```

Apply speaker notes:

```sh
pptxify slides.pdf --notes speaker-notes.md
```

Use short options and suppress progress output:

```sh
pptxify slides.pdf -p 150 -o slides-150.pptx --quiet
```

### Exit behavior

- `--help` and `--version` exit successfully without reading a PDF.
- Successful conversion returns status `0` after the PPTX has been written.
- Invalid input, unsupported PDFs, invalid PPI, safety-limit failures, malformed
  notes, and output errors return a non-zero status and write an error to stderr.

## Browser

Open <https://tshzhu.github.io/pptxify/>, then:

1. Choose one PDF, or drag it onto the upload area.
2. Keep the default **600 PPI**, or select another image resolution.
3. Click **Convert to PPTX** and wait for rendering and packaging.
4. Click **Download PPTX**.

Conversion does not start a download automatically. The generated result remains
available until you reset the page or choose another PDF. **Cancel** stops the
current conversion without clearing the selected file.

After upload, changing PPI recalculates the estimate without reading the PDF
again. Conversion reuses that inspection, and the browser's notes editor accepts
the same `## page: N` syntax described above.

## Input and output

Each output slide contains one full-page PNG, and the PowerPoint slide size
matches the PDF page size. This preserves the appearance of fonts, equations,
figures, vector artwork, and Beamer styling without requiring LaTeX or PowerPoint
during conversion.

The output is flattened: text, links, animations, and individual graphics are not
editable PowerPoint objects. Beamer overlays that already appear as separate PDF
pages become separate slides.

Both browser and CLI enforce these limits:

- One non-empty PDF with a valid PDF header
- Maximum file size: **100 MB**
- Maximum page count: **120 pages**
- One consistent page size throughout the document
- Integer PPI from **1 to 600**
- Maximum total estimate: **400 MP** across all pages
- Maximum Canvas size: **8192 px per side**
- No password-protected PDFs

If a conversion exceeds a pixel or Canvas limit, lower the PPI or split the PDF.
Memory use and final PPTX size also depend on page contents and PNG compressibility.

## How it works

1. Validate the PDF, page count, and page dimensions.
2. Convert the selected PPI into per-page pixel dimensions and check safety
   limits.
3. Render PDF pages to white PNG Canvases with bounded concurrency. Small pages
   may use two in-flight renders; larger pages remain serial.
4. Insert images into the PPTX in PDF page order using a custom layout that
   matches the PDF dimensions.
5. Package the PPTX without applying a redundant second compression pass to the
   already-compressed PNG files.
6. Patch speaker notes when requested without rendering the PDF again.

## Development

```sh
npm ci
npm run dev
npm run check
npm run build
npm run build:cli
npm run build:all
npm run pack:check
npm run preview
```

- `npm run dev` starts the Vite development server.
- `npm run check` performs TypeScript type checking.
- `npm run build` creates the browser site in `dist/`.
- `npm run build:cli` creates the Node.js CLI in `dist-cli/`.
- `npm run build:all` creates both outputs.
- `npm run pack:check` verifies that the npm tarball contains only the CLI build,
  README, LICENSE, and package metadata.
- `npm run preview` serves the production browser build locally after
  `npm run build`.

The GitHub Pages workflow runs `npm ci` and `npm run build`, uploads `dist/`, and
deploys it whenever `main` is updated. npm releases are separate: the Trusted
Publishing workflow runs only when a matching `v*` Git tag is pushed.

## Technology

- [PDF.js](https://mozilla.github.io/pdf.js/) reads and renders PDF pages.
- [PptxGenJS](https://gitbrent.github.io/PptxGenJS/) creates the image-based PPTX.
- [JSZip](https://stuk.github.io/jszip/) reads and updates speaker-note XML.
- [Vite](https://vite.dev/) and TypeScript build the website and CLI.

## License

[MIT](LICENSE)
