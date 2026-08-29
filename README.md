# PPTXify

**PPTXify** converts a PDF presentation into a high-quality, image-based
PowerPoint file entirely in your browser or from a local Node.js CLI:

```text
PDF → high-resolution PNG pages → image-based PPTX
```

It is designed for LaTeX Beamer presentations, but it also works with standard
PDFs whose pages all have the same dimensions. Browser and CLI processing are
local; no PDF is uploaded to a server.

[Try it out in your browser](https://tshzhu.github.io/pptxify/)

There are two ways to use PPTXify:

- [In your browser](#browser), with no local installation.
- [From the CLI](#cli), after cloning and building this repository locally.

## CLI

The CLI performs the same PDF → PNG → image-based PPTX conversion locally with
Node.js. It never overwrites the input PDF and writes the final output atomically.

### Requirements and local build

Node.js 22 or newer is required. PPTXify is not currently published to the npm
registry. The supported CLI workflow is to clone this repository, install its
locked dependencies locally, and build the command-line output:

```bash
git clone https://github.com/tshzhu/pptxify.git
cd pptxify
npm ci
npm run build:all
```

`npm ci` installs the exact dependency versions recorded in `package-lock.json`
into this checkout; it does not install a global `pptxify` command. The package
is marked private to prevent accidental npm publication.

The build scripts produce these outputs:

| Command | Output |
| --- | --- |
| `npm run build` | Browser site in `dist/` |
| `npm run build:cli` | Node.js CLI in `dist-cli/` |
| `npm run build:all` | Both outputs |

### Usage

Run the built CLI from the repository root:

```bash
node dist-cli/cli.js presentation.pdf
```

The CLI executable name declared in `package.json` is `pptxify`, but the package
is not published or globally installed. From a clone, invoke the built entry
point with `node dist-cli/cli.js`.

By default, conversion uses **600 PPI** and writes
`presentation-600ppi.pptx` next to the input file. Progress is printed to stderr;
the completion line with the output path is printed to stdout.

### Input and output behavior

- Exactly one input PDF path is accepted.
- The input PDF is never replaced.
- If `--output` is omitted, the output is written beside the input as
  `<input-name>-<PPI>ppi.pptx`.
- Output files are written atomically, so a failed conversion does not replace
  an existing file.
- `--notes` patches speaker notes after rendering without rendering the PDF a
  second time.

### Options

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
    Print the version declared by this local checkout's package.json.
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

`N` is a 1-based PDF page number. Empty note sections, duplicate or out-of-range
pages, malformed headings, and text before the first heading are rejected before
the output is replaced. `.txt` and `.md` files are read as UTF-8. Only the new
`## page: N` syntax is supported.

### Command examples

```bash
# 600 PPI, default output name
node dist-cli/cli.js slides.pdf

# 300 PPI and an explicit output path
node dist-cli/cli.js slides.pdf --ppi 300 --output build/slides.pptx

# Add notes to pages 1 and 4
node dist-cli/cli.js slides.pdf --notes speaker-notes.md

# Use short aliases and suppress progress output
node dist-cli/cli.js slides.pdf -p 150 -o slides-150.pptx --quiet
```

### Exit behavior

- `--help` and `--version` exit successfully without reading an input PDF.
- A successful conversion returns status `0` only after the PPTX has been written.
- Missing or invalid input, PPI errors, PDF validation failures, pixel/Canvas
  safety failures, malformed notes, and output write errors return a non-zero
  status.
- Fatal errors are printed to stderr. A failed conversion never replaces an
  existing output file.

## Browser

The browser app is the quickest way to make a presentation. Open
<https://tshzhu.github.io/pptxify/>, then:

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
uploading the PDF again. The browser reuses the successful PDF inspection while
converting, so it does not repeat the page-count and page-size scan immediately
before rendering.

The notes editor accepts the same `## page: N` syntax described in [Page notes](#page-notes).
All browser processing stays in the browser, and the generated PPTX is downloaded
only after an explicit user action.

## Supported input and output

Every output slide contains one full-page PNG. This preserves the visual
appearance of fonts, equations, vector artwork, figures, and Beamer styling
without requiring LaTeX or PowerPoint on the server. The PowerPoint slide size
matches the PDF page size rather than forcing a fixed 16:9 or 4:3 layout.

The trade-off is that PDF content is flattened. Text, hyperlinks, animations,
and individual graphics are not editable PowerPoint objects. Beamer overlays
already represented as separate PDF pages become separate slides.

PPTXify currently enforces these input and safety limits in both browser and CLI
paths:

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

## How conversion works

1. **Inspect the PDF.** The app validates the file, counts its pages, and checks
   that every page has the same physical dimensions.
2. **Estimate the output.** The selected PPI determines each page's pixel width
   and height. The app checks the total estimated pixels and Canvas dimensions
   before conversion begins.
3. **Render with bounded concurrency.** PDF.js renders onto white Canvases and
   exports each page as a PNG. Small pages may use at most two in-flight renders
   when the runtime has multiple workers; larger pages stay serial to avoid unsafe
   memory growth. Images are inserted into the PPTX in PDF page order, so the
   output remains deterministic without retaining every rendered page in memory.
4. **Build the presentation.** PptxGenJS creates a custom slide layout with the
   same physical width and height as the PDF. Each PNG fills one complete slide.
5. **Package and download.** The browser or CLI creates a file named
   `<pdf-name>-<PPI>ppi.pptx`; the browser downloads it manually.
6. **Patch notes when requested.** JSZip reads or updates the PPTX speaker-note
   XML without rerendering the PDF or changing the slide images.

All conversion steps are local. No PDF, rendered page, note, or generated PPTX is
uploaded to a server.

PPTX packaging stores the rendered PNGs without applying a second ZIP compression
pass. PNG is already compressed, so this keeps conversion responsive while
leaving image bytes and visual quality unchanged.

## Development

Node.js 22 or newer is required. From a clone of the repository:

```bash
npm ci
npm run dev
```

Run the checks and builds with:

```bash
npm run check
npm run build
npm run build:cli
npm run build:all
```

`npm run dev` starts the Vite development server. `npm run preview` serves the
production browser build locally after `npm run build`. The Vite build uses
relative asset URLs so the same static output works locally and below the
repository path on GitHub Pages. The CLI build writes the runnable Node artifact
to `dist-cli/`.

## GitHub Pages

The workflow in `.github/workflows/pages.yml` runs `npm ci`, builds the browser
site with `npm run build`, uploads `dist/`, and deploys it whenever `main` is
updated. It does not publish an npm package.

## Technology

- [PDF.js](https://mozilla.github.io/pdf.js/) reads and renders PDF pages.
- [PptxGenJS](https://gitbrent.github.io/PptxGenJS/) creates the image-based PPTX.
- [JSZip](https://stuk.github.io/jszip/) reads and updates speaker-note XML.
- [Vite](https://vite.dev/) and TypeScript build the website and CLI.

## License

This project is licensed under the [MIT License](LICENSE).
