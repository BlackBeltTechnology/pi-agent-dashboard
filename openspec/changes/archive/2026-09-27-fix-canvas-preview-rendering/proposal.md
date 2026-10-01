## Why

Follow-ups found while testing the AsciiDoc canvas (`fix-adoc-edit-and-file-save`):

- Word (`.docx` HTML mode) previews in the editor pane / canvas did not scroll: the pane supplies no
  scroll container and `DocxPreview` has none (same bug AsciiDoc had).
- AsciiDoc previews dropped the document title: asciidoctor's embedded convert omits `= Title`
  unless `showtitle` is set.
- Hydrated PlantUML diagrams sat in a fixed 400px box, cropping tall diagrams.
- `stem:[…]` / `[stem]` math showed as raw LaTeX: nothing rendered asciidoctor's latexmath passthrough.
- A canvas target delivered while the viewport was `mobile` (e.g. a short window) never auto-opened
  after the window grew: the driver consumed the target key even though the gate refused the open.

## What Changes

- Editor-pane `docx` viewer wrapped in its own scroll container.
- `/api/file/render` sets the asciidoctor `showtitle` attribute.
- `DiagramPreview` gains an `inline` mode (size to content, width-capped, aspect kept); AsciiDoc uses
  it instead of the fixed `h-[400px]` box.
- New pure `renderAdocMath` (KaTeX, skips `<pre>`/`<code>`), applied by `AsciiDocPreview` with a lazy
  `import("katex")` only when math delimiters are present.
- `CanvasDriver` consumes the auto-open key only when the gate allows the open.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `auto-canvas`: a target withheld on mobile opens once the viewport grows.
- `file-and-url-preview`: AsciiDoc title kept; PlantUML diagrams size to content; latexmath rendered;
  editor-pane wrappers of flow-height renderers scroll.

## Impact

- Client: `editor-pane/viewer-registry.tsx`, `preview/AsciiDocPreview.tsx`,
  `preview/DiagramPreview.tsx`, `lib/preview/adoc-math.ts` (new), `canvas/CanvasDriver.tsx`.
- Server: `routes/file-routes.ts` (`showtitle`).
- No API, dependency or storage change (KaTeX already a client dependency). No migration;
  rollback = revert.

## Discipline Skills

- `performance-optimization` — KaTeX (~260 KB) loaded via dynamic `import()` only for documents
  containing math, keeping it out of the main chunk.
- `systematic-debugging` — the canvas "first push lost" symptom was root-caused to the mobile gate
  (agent-browser's 1280×577 default viewport is `<600h` = mobile) consuming the key, not a transport
  problem.
