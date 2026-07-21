# Replace paged PDF canvas with pdfjs continuous-scroll viewer

> **Status: planned.** Swap `PdfPreview`'s hand-rolled single-canvas + Prev/Next paging for
> pdfjs-dist's built-in `PDFViewer` component (`pdfjs-dist/web/pdf_viewer.mjs`), giving native
> continuous scroll, text selection, and ctrl-F find. **Public component contract is unchanged**
> (`PdfPreview({ target, srcUrl })`), so the four callers (overlay route, `DocxPreview`,
> `PptxPreview`, `EmlPreview`) and their tests are untouched.

## Why

`PdfPreview` today renders **one page at a time** onto a single `<canvas>`, driven by a `pageNum`
state and a Prev/Next toolbar. Reading a multi-page PDF means clicking through page by page, with
no continuous scroll, no text selection, and no in-document find. This is the weakest of the file
previewers.

pdfjs-dist (already a dependency, pinned at **4.10.38**) ships a complete component viewer under
`web/pdf_viewer.mjs` — the same `PDFViewer` class its own reference viewer uses. It does
**virtualized continuous scroll** (renders only near-viewport pages, so a 200-page PDF does not
blow up memory), plus a **text layer** (selection + ctrl-F find) and link handling. Adopting it
replaces ~90 lines of manual canvas/page-state code with a construct-once-then-`setDocument` wiring
and gives a proper reading experience for free.

It also resolves an existing spec tension: `file-and-url-preview` §587 says renderers "SHALL NOT
contain navigation or surface chrome," yet `PdfPreview` today owns a Prev/Next toolbar. Removing it
in favour of native scroll brings the component into line.

## Mockup (visual target + review harness)

A self-contained, dependency-free mockup of the target viewer lives at
[`mockup/index.html`](mockup/index.html). Serve it with
`serve_mockup{dir:"openspec/changes/pdf-preview-continuous-scroll/mockup"}` (or open the file). It
demonstrates the proposed shape and doubles as a manual test harness:

- **AFTER · continuous scroll** — stacked pages in one dark-gutter scroll container, no Prev/Next
  chrome, real selectable text (proves the text layer). This is the target.
- **BEFORE · paged** — the current single-canvas + Prev/Next toolbar, for side-by-side contrast.
- **Toggle theme** — flips studio(dark)/light to show the gutter honouring `--bg-canvas`.

The mockup uses the **real** dashboard tokens from `packages/client/src/index.css`. It surfaced a
latent bug: `--bg-canvas` (referenced by today's `PdfPreview`) is **not defined** in the theme, so
the gutter currently has no themed background — the mockup sets it explicitly, and tasks §3 defines
the token as part of the dark-theming fix.

## What Changes

1. **`PdfPreview` internals** — construct a pdfjs `PDFViewer` (with `EventBus` + `PDFLinkService`)
   bound to an absolutely-positioned scroll container, import `pdfjs-dist/web/pdf_viewer.css`, and
   drive it via `viewer.setDocument(doc)`. Remove the `pageNum`/`pageCount` state, the two render
   effects, and the Prev/Next toolbar. **Text layer enabled** (`textLayerMode`) for selection +
   find.
2. **Container restructure** — the current `flex-1 overflow-auto` wrapper is replaced by a
   `position:relative` parent + `position:absolute inset-0 overflow-auto` `.pdfViewerContainer`
   (pdfjs measures its container and requires this shape). Must work in **both** mount contexts:
   the full-screen overlay route and the editor-pane `viewer-registry`.
3. **Dark theming** — override `pdf_viewer.css`'s default light gutter to honour the dashboard's
   `--bg-canvas` / theme tokens; prefer a dark viewer background.
4. **Spec delta** — `internal-monaco-editor-pane` §149 scenario "renders `PdfPreview` (canvas) with
   page navigation" → "continuous scroll viewer (text-selectable, find-capable)".
5. **Bundle-leak test** — assert `pdfjs-dist` stays out of the main JS chunk (existing §160
   guarantee) **and** that `pdf_viewer.css` does not leak into the main CSS bundle — both ride the
   already-lazy `PdfPreview` chunk.

## Non-Goals

- No zoom UI, thumbnail sidebar, print, or download chrome (the reference viewer's extras).
- No change to the `Props` contract, the `srcUrl` reuse, or the docx/pptx/eml render pipelines.
- No change to `/api/file/raw` or `/api/file/rendered-pdf` server streams.

## Discipline Skills

- `performance-optimization` — verify the virtualized scroll actually bounds memory on a large PDF
  (the whole point vs. the naive "render all pages" alternative rejected in design.md).
- `review-code` — non-trivial component rewrite; review before commit.

## Coordinates With

- `render-office-previews`, `render-pptx-preview`, `add-eml-preview` — all reuse `PdfPreview` via
  `srcUrl`; contract preserved, no coordination needed beyond keeping the prop shape.
