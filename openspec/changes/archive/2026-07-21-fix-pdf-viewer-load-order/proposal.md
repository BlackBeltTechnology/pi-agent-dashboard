# Fix PDF Viewer globalThis Load-Order Race

## Why

The dashboard PDF preview fails to render with:

> Cannot destructure property 'AbortException' of 'globalThis.pdfjsLib' as it is
> undefined.

Root cause is a module-load ordering race in `PdfPreview.tsx`:

- `pdfjs-dist/web/pdf_viewer.mjs` destructures `globalThis.pdfjsLib` at
  **module-evaluation time** (top-level `const { AbortException, … } =
  globalThis.pdfjsLib`). It has **no** static import of the main module.
- `globalThis.pdfjsLib` is set only as a **side effect** when the main
  `pdfjs-dist` module (`build/pdf.mjs`) evaluates
  (`var __webpack_exports__ = globalThis.pdfjsLib = {}`).
- `mountViewer` loaded both concurrently via
  `Promise.all([loadPdfJs(), loadViewer()])`. Because Vite splits the two into
  separate chunks with **no module-graph dependency** between them, evaluation
  order is not guaranteed. When the viewer chunk evaluates before the main
  chunk populates `globalThis.pdfjsLib`, the top-level destructure throws.

The failure is timing-dependent (chunk hashing / network arrival order), which
is why it surfaced intermittently rather than always.

## What Changes

- **Sequence the lazy loads.** In `mountViewer`, `await loadPdfJs()` (which
  evaluates the main module and populates `globalThis.pdfjsLib`) **before**
  `await loadViewer()` (which imports `pdf_viewer.mjs`). Replace the racing
  `Promise.all` with sequential awaits. This ordering is load-bearing, not a
  style choice: the concurrent load is what triggers the crash, so it MUST NOT
  be reverted to a `Promise.all`. The rationale lives here in the proposal and
  in the `file-and-url-preview` spec requirement, plus a brief inline comment at
  the call site to deter reverting the sequence back to a concurrent load.

Out of scope: the continuous-scroll rendering behaviour and the lazy-chunk
bundle split (both unchanged); upgrading `pdfjs-dist`.

## Impact

- **Fixes:** the `globalThis.pdfjsLib` undefined crash on PDF, DOCX→PDF,
  PPTX→PDF, and EML PDF-attachment previews (all route through `PdfPreview`).
- **Risk:** minimal — sequential awaits are strictly safer than the prior
  concurrent load and preserve all observable behaviour. The two loads were
  never truly parallel in effect (the viewer cannot construct until the doc is
  fetched, which needs `pdfjs` anyway).
- **Affected specs:** `file-and-url-preview` (MODIFIED requirement — adds the
  load-order invariant + scenario to the continuous-scroll viewer requirement).
- **Affected code:** `packages/client/src/components/preview/PdfPreview.tsx`.

## Discipline Skills

- `systematic-debugging` — traced the destructure crash to the side-effect
  global set by the main chunk and the missing module-graph edge to the viewer
  chunk before changing code.
- `doubt-driven-review` — confirmed sequential awaits preserve behaviour and
  that no other call site loads the viewer + lib concurrently.
