# pptxify

**pptxify** converts a PDF presentation into a high-quality, image-based
PowerPoint file entirely in your browser:

```text
PDF → high-resolution PNG pages → image-based PPTX
```

It is designed for LaTeX Beamer presentations, but it also works with standard
PDFs whose pages all have the same dimensions. There is no backend: your PDF and
generated presentation stay on your device.

[Open pptxify](https://tshzhu.github.io/pptxify/)

## Quick start

1. Open the [pptxify website](https://tshzhu.github.io/pptxify/).
2. Choose one PDF, or drag it onto the upload area.
3. Keep the default **600 PPI**, or select another image resolution.
4. Click **Convert to PPTX** and wait for the pages to render and package.
5. Click **Download PPTX**.

Conversion never starts a download automatically. **Download PPTX** may be used
again while the result is cached; **Reset** or choosing another PDF clears that
result and its notes.

## Choose the image PPI

Image PPI controls the raster resolution of every slide image:

- The accepted range is any integer from **1 to 600 PPI**.
- The default is **600 PPI**.
- The available presets are **72, 96, 150, 200, 300, and 600 PPI**.
- Higher values produce sharper raster images, but require more memory, take
  longer to process, and usually create larger PPTX files.

After a PDF has been inspected, changing the PPI recalculates its pixel estimate
immediately. If a high value exceeds the safety budget, lower the PPI and retry;
you do not need to upload the PDF again.

During conversion or note processing, **Cancel** requests cancellation and keeps
the selected PDF available for another attempt. After a successful conversion,
**Reset** clears the PDF, generated PPTX, notes, status, and download URL.

## Add speaker notes

Speaker notes are optional. Convert the PDF first, then click **Add notes** and
enter one Markdown section for each PDF page that needs a note:

```markdown
## page: 1
Opening note

## page: 3
Note for the third page
```

`page` is the 1-based PDF page number. Pages may be omitted when they do not need
notes. The editor rejects malformed headings, duplicate or out-of-range page
numbers, empty note sections, and text before the first page heading.

Click **Apply notes** to update the downloadable presentation. Clicking
**Edit notes** and applying changes again always starts from the cached,
unannotated PPTX, so the PDF pages are not rendered again. Applying an empty
editor restores the unannotated PPTX.

The Markdown is stored as plain PowerPoint speaker-note text. It is not rendered
as formatted Markdown and does not become an editable slide object.

### Import existing notes

You can drag one of these files directly onto the notes textarea:

- `.txt` or `.md`: replaces the editor contents with the file text as-is.
- `.pptx`: extracts non-empty PowerPoint speaker notes and converts them into
  ascending `## page: N` sections.

The imported text is still validated against the current PDF when you click
**Apply notes**. Legacy `.ppt` files, unsupported file types, malformed PPTX
packages, and unsupported notes structures are rejected.

## How conversion works

1. **Inspect the PDF.** The app validates the file, counts its pages, and checks
   that every page has the same physical dimensions.
2. **Estimate the output.** The selected PPI determines each page's pixel width
   and height. The app checks the total estimated pixels and Canvas dimensions
   before conversion begins.
3. **Render serially.** PDF.js renders one page at a time onto a white Canvas and
   exports it as a PNG. Serial rendering keeps the active Canvas workload to one
   page at a time.
4. **Build the presentation.** PptxGenJS creates a custom slide layout with the
   same physical width and height as the PDF. Each PNG fills one complete slide.
5. **Package and download.** The browser creates a file named
   `<pdf-name>-<PPI>ppi.pptx`; the user downloads it manually.
6. **Patch notes when requested.** JSZip reads or updates the PPTX speaker-note
   XML without rerendering the PDF or changing the slide images.

All of these steps run locally in the browser. No PDF, rendered page, note, or
generated PPTX is uploaded to a server.

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
PDF. If a page exceeds the per-side Canvas limit, lower the PPI. Browser memory
and the final PPTX size also depend on the PDF contents and PNG compressibility,
so very large conversions may still require a lower PPI or a smaller PDF.

## Local development

Node.js 22 or newer is required.

```bash
npm ci
npm run dev
```

Run the TypeScript check and production build with:

```bash
npm run check
npm run build
```

Preview the completed production build with:

```bash
npm run preview
```

The Vite build uses relative asset URLs so the same static output works locally
and below the repository path on GitHub Pages. The workflow in
`.github/workflows/pages.yml` installs dependencies, builds `dist/`, uploads the
Pages artifact, and deploys it whenever `main` is updated.

## Technology

- [PDF.js](https://mozilla.github.io/pdf.js/) reads and renders PDF pages.
- [PptxGenJS](https://gitbrent.github.io/PptxGenJS/) creates the image-based PPTX.
- [JSZip](https://stuk.github.io/jszip/) reads and updates speaker-note XML.
- [Vite](https://vite.dev/) and TypeScript build the static website.

## License

This project is licensed under the [MIT License](LICENSE).
