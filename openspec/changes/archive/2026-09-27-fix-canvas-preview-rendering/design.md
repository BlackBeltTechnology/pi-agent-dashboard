## Context

The editor pane mounts renderers via `viewerRegistry` without a scroll container; the overlay route
supplies `overflow-y-auto`. AsciiDoc HTML comes from asciidoctor's embedded convert
(`standalone: false`). PlantUML SVGs come from Kroki with fixed inline `style="width;height"`.
`CanvasDriver` auto-opens a target once per `target+version` key, gated by viewport tier.

## Goals / Non-Goals

**Goals:** fix the five rendering/delivery defects with minimal, local changes.

**Non-Goals:** asciimath (`:stem:` default) rendering, only `latexmath`; changing the overlay route;
new diagram types.

## Decisions

### D1 — Scroll container belongs to the editor-pane wrapper

Same boundary as the shared-renderers requirement: renderers own no surface chrome, the wrapper
owns the shell. `DocxViewer` gets `h-full min-h-0 overflow-auto`, mirroring the overlay's scroller.
AsciiDoc already gets it from `EditablePreviewTab`.

### D2 — `showtitle` attribute, not standalone output

Standalone output would add `<html>/<head>` and asciidoctor's stylesheet. `showtitle` keeps the
embedded body and only emits the `<h1>`; the existing `.asciidoc-body > h1:first-child` style applies.

### D3 — `DiagramPreview inline` instead of a bigger fixed box

Any fixed height either crops or wastes space. Inline mode drops `h-full`, and the SVG gets
`max-w-full` plus `!h-auto`, which is needed because Kroki's inline height would otherwise win. Wide
diagrams scale down, tall ones grow, and the aspect ratio holds (viewBox). The zoom/pan viewport stays.
The file-level `.puml` viewer keeps the fill-parent mode.

### D4 — Pure `renderAdocMath` + lazy KaTeX

A string transform before segment splitting keeps `AsciiDocPreview` simple and makes the logic
unit-testable with real KaTeX. `<pre>`/`<code>` spans are split out first so code listings keep
literal `\(`. KaTeX escapes its input (`trust` off); `throwOnError: false` renders bad TeX as an
inline error. Dynamic import gated on `hasAdocMath` keeps KaTeX out of documents without math.

### D5 — Consume the canvas key only on an allowed open

`tier` was already an effect dependency; the key was just recorded too early. Recording it only after
`gateAllowsAutoOpen(tier)` makes a mobile→desktop resize deliver the pending target, while an
opened target is still never re-opened for the same key.

## Risks / Trade-offs

- [Mobile→desktop re-open after a chip tap] → target may be re-opened once; `openFile` is
  idempotent, so it just re-selects the existing tab.
- [`!important` in the SVG sizing class] → scoped to inline mode only.
