# Tasks

## 1. Diagnose (systematic-debugging)

- [x] 1.1 Confirm `pdfjs-dist/web/pdf_viewer.mjs` destructures `globalThis.pdfjsLib` at module top level (no static import of `build/pdf.mjs`).
- [x] 1.2 Confirm `globalThis.pdfjsLib` is set only as a side effect of the main `pdfjs-dist` (`build/pdf.mjs`) module evaluating.
- [x] 1.3 Confirm `mountViewer` loaded both chunks via `Promise.all`, leaving evaluation order unconstrained.

## 2. Fix load ordering

- [x] 2.1 In `PdfPreview.tsx` `mountViewer`, replace `Promise.all([loadPdfJs(), loadViewer()])` with `await loadPdfJs()` then `await loadViewer()`.
- [x] 2.2 Add an inline comment documenting the `globalThis.pdfjsLib` invariant so the ordering is not reverted to a concurrent load.

## 3. Verify

- [x] 3.1 `PdfPreview.test.tsx` suite green (4/4).
- [x] 3.2 Manual: open a PDF (and a DOCX→PDF) preview in the dashboard after `npm run build`; the viewer renders with no `AbortException`/`globalThis.pdfjsLib` error.

## 4. Docs

- [x] 4.1 Update the `PdfPreview.tsx` row in `packages/client/src/components/preview/AGENTS.md` to record the load-order invariant and correct the stale canvas/page-nav description.

## Validate

- [x] V1 `openspec validate fix-pdf-viewer-load-order --strict` passes.
- [x] V2 `npm test` green (client preview suite).
