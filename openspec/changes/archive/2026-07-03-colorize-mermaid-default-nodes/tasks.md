# Tasks — Colorize default Mermaid nodes

## 1. Palette + helpers
- [x] 1.1 Add `resolveAccents()` reading the 6 `--accent-*` vars via
      `getComputedStyle(document.documentElement)`, with a hardcoded fallback ramp.
      → verify: returns 6 non-empty hex strings under each theme.
- [x] 1.2 Add `hashId(id)` deterministic string hash (djb2/FNV-1a).
      → verify: same id → same index; distinct ids spread across palette.
- [x] 1.3 Add `rgba(hex, alpha)` helper for the soft wash (fill @ ~0.08, border
      @ ~0.85). No luminance/darken needed — label keeps `--text-primary`.
      → verify: `rgba("#3b82f6",0.08)` → `rgba(59,130,246,0.08)`.

## 2. Colorize pass
- [x] 2.1 Add `colorizeDefaultNodes(svg, accents, textColor)` using DOMParser;
      skip shapes whose inline `style` contains `fill:`; give default nodes an
      8% accent wash fill + full-accent border + `--text-primary` label, keyed
      by `hash(g.id)`.
      → verify: fixture flowchart — default nodes get accent fills, `style B`
      node keeps `#ff0000`, `classDef` node keeps its fill.
- [x] 2.2 Handle class-diagram `<path fill=…>` shape (override attr + style).
      → verify: fixture classDiagram — default classes colorized, `style Dog`
      keeps `#00ff00`.

## 3. Wire into MermaidBlock
- [x] 3.1 Call `colorizeDefaultNodes` between `sanitizeMermaidSvg` and injection.
      → verify: rendered SVG in DOM shows accent fills on default nodes.
- [x] 3.2 Confirm `_svgCache`/`_errorCache` keying unchanged (per code+theme).
      → verify: theme switch re-colorizes; remount uses cache with no flash.

## 4. Tests
- [x] 4.1 Unit: detection predicate (authored vs default) on both diagram types.
- [x] 4.2 Unit: stability — same node id → same color across two renders with an
      added unrelated node.
- [x] 4.3 Unit: default node fill is low-opacity (~8%) accent wash, border is
      full accent, label keeps theme text color.
- [x] 4.4 Theme: dark vs light palettes differ (accent set swaps).
      → verify: `npm test` passes; `MermaidBlock.test.tsx` green.

## 5. Verify + doc
- [x] 5.1 `npm run build` + restart; visually confirm colorful default diagrams,
      untouched author-colored nodes, per-theme correctness (4 themes).
- [x] 5.2 Update `MermaidBlock.tsx.AGENTS.md` row with the colorize behavior +
      `See change: colorize-mermaid-default-nodes`.
- [x] 5.3 `openspec validate colorize-mermaid-default-nodes --strict`.
