# pptxify

**pptxify** converts a PDF presentation into a high-quality, image-based
PowerPoint file entirely in your browser or from a local Node.js CLI:

```text
PDF → high-resolution PNG pages → image-based PPTX
```

It is designed for LaTeX Beamer presentations, but it also works with standard
PDFs whose pages all have the same dimensions. Browser and CLI processing are
local; no PDF is uploaded to a server.

[Try it out in your browser](https://tshzhu.github.io/pptxify/)

There are two ways to use pptxify:

- [In your browser](#browser), with no installation.
- [From the CLI](#cli), for repeatable local conversion in scripts and terminals.

## Example

Convert a presentation at 300 PPI and write the result to a chosen path:

```bash
pptxify presentation.pdf --ppi 300 --output presentation.pptx
```

The command renders every PDF page as a PNG and creates one full-page image slide
per page.

## Browser

The browser app is the quickest way to make a presentation:

1. Choose one PDF, or drag it onto the upload area.
2. Keep the default **600 PPI**, or select another image resolution.
3. Click **Convert to PPTX** and wait for inspection, rendering, and packaging.
4. Click **Download PPTX**.

Conversion never starts a download automatically. **Download PPTX** may be used
again while the result is cached; **Reset** or choosing another PDF clears that
result and its notes. During conversion, **Cancel** keeps the selected PDF
available for another attempt.

After a PDF has been inspected, changing PPI recalculates its estimate immediately.
If a high value exceeds the safety budget, lower the PPI and retry without
uploading the PDF again.

The browser keeps the same PDF inspection while converting, so it does not repeat
the page-count and page-size scan immediately before rendering.

## CLI

The CLI performs the same PDF → PNG → image-based PPTX conversion locally with
Node.js. It never overwrites the input PDF and writes the final output atomically.

### Installation

Install the executable from a published package, or install/link a checkout during development:

```bash
npm install -g pptxify
# or, from a checkout:
npm install -g .
# or link the checkout:
npm link
```

### Basic usage

```bash
pptxify presentation.pdf
```

By default this uses **600 PPI** and writes
`presentation-600ppi.pptx` next to the input file. Progress is printed to stderr;
the completion line with the output path is printed to stdout.

### CLI options

```text
-p, --ppi <number>
    Render at an integer PPI from 1 to 600. Default: 600.

-o, --output <path>
    Write the PPTX to this path instead of the default sibling path.

    --notes <path>
    Read UTF-8 page notes from a .txt or .md file and apply them after rendering.

-q, --quiet
    Suppress progress logs. Fatal errors are still printed to stderr.

-h, --help
    Show the complete command help.

-v, --version
    Print the installed pptxify version.
```

Examples:

```bash
# 600 PPI, default output name
pptxify slides.pdf

# 300 PPI and an explicit output path
pptxify slides.pdf --ppi 300 --output build/slides.pptx

# Add notes to pages 1 and 4
pptxify slides.pdf --notes speaker-notes.md

# Use short aliases and suppress progress output
pptxify slides.pdf -p 150 -o slides-150.pptx --quiet
```

The process exits with status `0` only after the PPTX has been written
successfully. Missing or invalid input, PPI errors, PDF validation failures,
pixel/Canvas safety failures, malformed notes, and output write errors return a
non-zero status. A failed conversion never replaces an existing output file.

### CLI page notes

The `--notes` file uses the same syntax as the browser editor:

```markdown
## page: 1
Opening note

## page: 4
Note for page four
```

`N` is a 1-based PDF page number. Empty note sections, duplicate or out-of-range
pages, malformed headings, and text before the first heading are rejected before
the output is replaced. `.txt` and `.md` files are read as UTF-8. Applying notes
patches the generated PPTX and does not render the PDF a second time.

## How conversion works

1. **Inspect the PDF.** The app validates the file, counts its pages, and checks
   that every page has the same physical dimensions.
2. **Estimate the output.** The selected PPI determines each page's pixel width
   and height. The app checks the total estimated pixels and Canvas dimensions
   before conversion begins.
3. **Render serially.** PDF.js renders one page at a time onto a white Canvas and
   exports it as a PNG. Serial rendering keeps the active Canvas workload to one
   page at a time while avoiding unsafe parallel memory growth.
4. **Build the presentation.** PptxGenJS creates a custom slide layout with the
   same physical width and height as the PDF. Each PNG fills one complete slide.
5. **Package and download.** The browser or CLI creates a file named
   `<pdf-name>-<PPI>ppi.pptx`; the browser downloads it manually.
6. **Patch notes when requested.** JSZip reads or updates the PPTX speaker-note
   XML without rerendering the PDF or changing the slide images.

All steps are local. No PDF, rendered page, note, or generated PPTX is uploaded
to a server.

## Output model and trade-offs

Every output slide contains one full-page PNG. This preserves the visual
appearance of fonts, equations, vector artwork, figures, and Beamer styling
without requiring LaTeX or PowerPoint on the server. The PowerPoint slide size
matches the PDF page size rather than forcing a fixed 16:9 or 4:3 layout.

The trade-off is that PDF content is flattened. Text, hyperlinks, animations,
and individual graphics are not editable PowerPoint objects. Beamer overlays
already represented as separate PDF pages become separate slides.

## Input validation and browser safety limits

pptxify currently enforces these checks:

- Exactly one non-empty PDF is processed at a time, and the file must have a PDF
  signature.
- Maximum PDF size: **100 MB**.
- Maximum page count: **120 pages**.
- Every page must have the same dimensions as page 1.
- Password-protected PDFs are not supported.
- PPI must be an integer from **1 to 600**.
- Total estimated output: at most **400 MP** (400 million pixels across all
  pages).
- Single-page Canvas size: at most **8192 px per side**.

If the total estimate is too large, lower the PPI, use fewer pages, or split the
PDF. If a page exceeds the per-side Canvas limit, lower the PPI. Browser memory,
CLI memory, and final PPTX size also depend on PDF contents and PNG compressibility.

## Local development

Node.js 22 or newer is required.

```bash
npm ci
npm run dev
```

Run the browser and CLI checks/builds with:

```bash
npm run check
npm run build:all
```

Preview the browser production build with:

```bash
npm run preview
```

The Vite build uses relative asset URLs so the same static output works locally
and below the repository path on GitHub Pages. The CLI build writes the runnable
Node artifact to `dist-cli/`.

## GitHub Pages

The workflow in `.github/workflows/pages.yml` installs dependencies, builds
`dist/`, uploads the Pages artifact, and deploys it whenever `main` is updated.

## CLI development

Build and run the CLI directly from a checkout:

```bash
npm run build:cli
node dist-cli/cli.js --help
node dist-cli/cli.js presentation.pdf --ppi 300 --output presentation.pptx
```

The package exposes the same entry point when linked with `npm link`.
The CLI uses PDF.js's Node build and `@napi-rs/canvas`; no browser, LaTeX,
PowerPoint, or server is required.

## Technology

- [PDF.js](https://mozilla.github.io/pdf.js/) reads and renders PDF pages.
- [PptxGenJS](https://gitbrent.github.io/PptxGenJS/) creates the image-based PPTX.
- [JSZip](https://stuk.github.io/jszip/) reads and updates speaker-note XML.
- [Vite](https://vite.dev/) and TypeScript build the website and CLI.

## License

This project is licensed under the [MIT License](LICENSE).
