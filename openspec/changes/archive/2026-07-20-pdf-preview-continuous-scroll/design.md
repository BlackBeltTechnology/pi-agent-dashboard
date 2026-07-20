# Design — pdfjs continuous-scroll viewer

## Decision: adopt the pdfjs component viewer, not a hand-rolled multi-canvas

Three approaches were weighed:

| Option | How | Scroll | Memory (large PDF) | Text select / find | Code |
|---|---|---|---|---|---|
| A — render all pages | one `<canvas>` per page, all up front | native | **unbounded** (N canvases) | no | low |
| B — hand-rolled virtualization | IntersectionObserver mounts near-viewport canvases | native | bounded | no (unless we also build a text layer) | medium-high |
| **C — pdfjs `PDFViewer`** | construct the library's own component viewer | native, virtualized | **bounded** | **yes, built-in** | medium |

**Chosen: C.** It is the only option that delivers virtualized scroll *and* text selection/find
without us reimplementing pdfjs internals, and it is the same code path pdfjs's own reference viewer
uses. A/B were rejected: A janks and blows memory on large PDFs (the corpus includes multi-hundred-
page docs); B gets bounded memory but still lacks a text layer, so we'd be rebuilding what `PDFViewer`
already ships.

## Component wiring

pdfjs 4.10.38 exports from `pdfjs-dist/web/pdf_viewer.mjs`: `PDFViewer`, `EventBus`,
`PDFLinkService`, `PDFFindController`, `ScrollMode`, plus `web/pdf_viewer.css`.

```
loadPdfJs()            (unchanged — worker via ?url)
   │
getDocument(url).promise → doc
   │
const eventBus    = new EventBus();
const linkService = new PDFLinkService({ eventBus });
const viewer      = new PDFViewer({
                      container,          // the .pdfViewerContainer (abs-positioned scroll box)
                      eventBus,
                      linkService,
                      textLayerMode: 2,   // enable text layer → selection + find
                    });
linkService.setViewer(viewer);
viewer.setDocument(doc);
linkService.setDocument(doc, null);
```

Construct once per document load (in the load effect); tear down on unmount / target change
(`doc.destroy()`, drop the viewer). No `pageNum`/`pageCount` state, no second render effect.

## The container-sizing gotcha (the real integration risk)

`PDFViewer` measures its `container` and requires a specific DOM shape:

```
<div style="position:relative; height:100%">        ← positioned parent
  <div class="pdfViewerContainer"                    ← container handed to PDFViewer
       style="position:absolute; inset:0; overflow:auto">
    <div class="pdfViewer" />                         ← PDFViewer fills this in
  </div>
</div>
```

The current `flex flex-col h-full` + `flex-1 overflow-auto` wrapper does **not** satisfy this
(the viewer needs an absolutely-positioned container with a definite height). This restructure must
hold in **both** mount contexts — the overlay route and the editor-pane `viewer-registry` wrapper —
which is why it is called out as its own task with a scenario in each context.

## Dark theming

`pdf_viewer.css` ships a light default (page gutter `#404040`-ish / white pages). We import it, then
override the container background to the dashboard token:

```css
.pdfViewerContainer { background: var(--bg-canvas); }
```

Pages themselves stay the PDF's own colour (a PDF is authored light); only the surrounding gutter
follows the theme. Prefer dark gutter under dark themes.

## Bundle hygiene

Both `pdf_viewer.mjs` and `pdf_viewer.css` are imported *from within* the already-`React.lazy`
`PdfPreview`, so Vite keeps them in the lazy chunk. The existing §160 JS assertion is extended with a
CSS assertion (`pdf_viewer.css` rules absent from `assets/index-*.css`) — see tasks §5.

## Contract preservation

`Props { target, srcUrl? }` is untouched. The four callers pass the same props; the docx/pptx/eml
tests `vi.mock("../PdfPreview.js")` so they never load pdfjs and remain valid. No server change.
