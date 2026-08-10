# Tasks — pdfjs continuous-scroll viewer

## 1. Rewrite PdfPreview internals to the pdfjs component viewer

- [x] 1.1 Import `PDFViewer`, `EventBus`, `PDFLinkService` from `pdfjs-dist/web/pdf_viewer.mjs` and
      the stylesheet `pdfjs-dist/web/pdf_viewer.css` (both from within the lazy component).
- [x] 1.2 In the document-load effect, construct `EventBus` + `PDFLinkService` + `PDFViewer`
      (`textLayerMode: 2`), call `setViewer`, then `viewer.setDocument(doc)` +
      `linkService.setDocument(doc, null)`. Tear down on unmount / target change.
- [x] 1.3 Remove `pageNum`/`pageCount` state, the per-page render effect, and the Prev/Next toolbar.
- [x] 1.4 Update the file header comment (drop "Page navigation: Prev / Next").

## 2. Container restructure (both mount contexts)

- [x] 2.1 Replace the `flex-1 overflow-auto` wrapper with `position:relative` parent +
      `position:absolute inset-0 overflow-auto` `.pdfViewerContainer` holding `<div class="pdfViewer">`.
- [x] 2.2 Verify layout in the overlay route (`/pi-view`) AND the editor-pane `viewer-registry`
      (`PdfViewer` wrapper) — the viewer must get a definite height in both.

## 3. Dark theming

- [x] 3.1 Define `--bg-canvas` in `packages/client/src/index.css` per theme (it is currently
      referenced by `PdfPreview` but NOT defined — see mockup finding). Override
      `.pdfViewerContainer` background to `var(--bg-canvas)`; confirm the gutter follows dark themes
      while pages keep their authored colour. Visual target: `mockup/index.html` (Toggle theme).

## 4. Tests — behaviour

- [x] 4.0 Visual acceptance: the built component matches `mockup/index.html` (AFTER view) — dark
      gutter, stacked pages, no Prev/Next chrome, selectable text. Manual check during 7.2 smoke.
- [x] 4.1 Continuous scroll: mount `PdfPreview` on a multi-page fixture (pdfjs mocked or a small real
      PDF), assert a single scroll container with stacked pages and NO Prev/Next controls.
      (test-plan: continuous-scroll scenario)
- [x] 4.2 Text layer: assert the viewer is constructed with the text layer enabled (selection/find).
- [x] 4.3 Contract: assert `DocxPreview`/`PptxPreview`/`EmlPreview` tests still pass unchanged
      (they `vi.mock` `PdfPreview` — should be green with no edits).

## 5. Tests — bundle hygiene

- [x] 5.1 Extend the §160 build assertion: after `npm run build`, main JS chunk excludes
      `pdfjs-dist` (existing) AND main CSS chunk (`assets/index-*.css`) excludes the `pdf_viewer.css`
      rules (`.pdfViewer` / `.textLayer` selectors); those rules appear only in a lazy asset.

## 6. Performance check (discipline: performance-optimization)

- [x] 6.1 On a large PDF (100+ pages), confirm memory stays bounded (virtualized) vs. the rejected
      "render all pages" approach — spot-check canvas count / heap, record the observation.

## 7. Review + land (discipline: review-code)

- [x] 7.1 `review-code` pass on the diff before commit.
- [x] 7.2 Rebuild client (`npm run build`) + restart, manual smoke: plain PDF, docx→pdf, pptx→pdf,
      eml PDF attachment all scroll and select text.
