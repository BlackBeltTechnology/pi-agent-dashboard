# Colorize default Mermaid nodes with theme accent palette

## Why

Mermaid diagrams render with mermaid's stock `default`/`dark` themes, which give
every node the same pale grey fill. The dashboard already defines a rich, theme-
aware accent palette (`--accent-blue/green/yellow/red/purple/orange`, light+dark
variants across all 4 themes), but none of it reaches the diagrams. Result:
diagrams look flat and washed-out, visually disconnected from the themed UI.

Users want automatic per-node color variety — each node a different accent hue —
**without** overriding colors the diagram author set explicitly (via `style X
fill:…`, `classDef`, or class-diagram `style`). Author intent must always win.

## What Changes

- Add an SVG post-processing pass in `MermaidBlock` that runs after
  `sanitizeMermaidSvg` and before DOM injection.
- The pass detects **default (un-authored) nodes** — shape elements whose inline
  `style` attribute contains no `fill:` — and assigns each a color from the
  current theme's accent palette.
- Color is keyed by a hash of the node's stable `id`, so a given node keeps its
  hue across diagram edits (deterministic, not positional).
- Author-colored nodes (inline `style` contains `fill:`) are left untouched.
- Colorization is a **soft tint**: fill is the active theme's accent at ~8% alpha
  (a subtle wash), the border is the full accent (carries identity), and the
  label keeps the theme's normal `--text-primary`. Accents resolve live via
  `getComputedStyle` for the active theme's dark/light set. Author-colored nodes
  stay full-saturation, so they read as emphasis against the soft defaults.
- Scope: flowchart + class diagrams (the two types whose default nodes share the
  detectable shape structure verified against mermaid 11.16 output).

## Impact

- Affected specs: `mermaid-diagram` (new requirement; existing rendering,
  theming, cache, sanitisation requirements unchanged).
- Affected code: `packages/client/src/components/MermaidBlock.tsx`
  (new `colorizeDefaultNodes` helper + call site), `MermaidBlock.test.tsx`.
- No protocol, server, or persistence changes. Purely client-side render output.
- Backward compatible: diagrams with explicit colors render identically.
