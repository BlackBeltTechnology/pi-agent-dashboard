# MermaidBlock.tsx — index

Renders fenced mermaid blocks via lazy `mermaid.render()`. Module-level `_svgCache`/`_errorCache` (keyed code+theme) avoid re-render flicker; serialized `renderQueue` guards concurrent renders. `sanitizeMermaidCode` (entity decode + dedent), `sanitizeMermaidSvg` (strip script/on*). Streaming-aware via `complete` prop; focus-gated zoom/pan + `ZoomControls`. Exports `MermaidBlock`, `_svgCache`, `_errorCache`.
