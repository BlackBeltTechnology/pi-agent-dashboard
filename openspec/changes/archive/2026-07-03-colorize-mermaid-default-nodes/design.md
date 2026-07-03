# Design — Colorize default Mermaid nodes

## Grounded detection signal (verified, not guessed)

Rendered against mermaid **11.16.0** with `theme:"base"`, inspecting the SVG DOM:

```
FLOWCHART
  A (unstyled)   <rect class="basic label-container" style="">        → DEFAULT
  B  style B     <rect ... style="fill:#ff0000 !important;stroke:…">  → AUTHORED
  C  classDef    <rect ... style="fill:#00ff00 !important">           → AUTHORED

CLASS DIAGRAM
  Animal (dflt)  <path fill="#eeeeee" style="">                       → DEFAULT
  Dog   styled   <path fill="#00ff00" style="fill:#00ff00">           → AUTHORED
```

**Unified rule:** the node's shape element inline `style` attribute contains
`fill:` ⇒ author set a color ⇒ **skip**. Empty / no `fill:` ⇒ **default** ⇒
colorize. This one predicate covers both `style X`, `classDef`, and class-diagram
`style` without parsing class names.

Node group `<g>` carries a stable `id` (`flowchart-A-0`, class name). Hash it →
palette index ⇒ deterministic, edit-stable color (node A always blue).

## Algorithm

Operate on a parsed SVG (DOMParser) rather than regex — safer, and we already
sanitize post-render.

```
colorizeDefaultNodes(svg, theme):
  palette = resolveAccents()          # 6 live accent hexes for active theme
  text    = resolveVar("--text-primary")
  doc = DOMParser.parseFromString(svg, "image/svg+xml")
  for g in doc.querySelectorAll("g.node, g.classGroup, g.node.default"):
    shape = g.querySelector("rect.label-container, polygon, circle, path")
    if !shape: continue
    if /fill\s*:/.test(shape.getAttribute("style") || ""): continue   # authored → skip
    hue = palette[ hash(g.id) % palette.length ]
    shape.style.fill        = rgba(hue, TINT)     # soft wash, TINT = 0.08
    shape.style.stroke      = rgba(hue, 0.85)     # accent border carries identity
    shape.style.strokeWidth = "1.5px"
    setLabelColor(g, text)             # keep theme's normal text color
  return serialize(doc)
```

### Soft-tint colorization (default)
Full-saturation fills read as too harsh. Instead the fill is the accent at low
alpha (`TINT = 0.08`, an 8% wash over the node background), the **border** is the
full accent (identity without shouting), and the **label keeps the theme's normal
text color** (readable on the light wash — no luminance flip needed). Author-
colored nodes stay full-saturation, so they naturally pop as emphasis against the
soft auto-tinted defaults — explicit color = "this matters", auto-tint = ambient
structure. Verified in the `/tmp/mermaid-mockup` reference at 8% across base /
dracula / nord / solarized, dark and light.

### resolveAccents()
`getComputedStyle(document.documentElement)` for the 6 accent vars. Runs at
colorize time, so the *current* theme's dark/light accent set is used
automatically. Falls back to a hardcoded 6-hue ramp if a var is empty.

### hash(id)
Small deterministic string hash (djb2/FNV-1a). Stable per node id → colors don't
reshuffle when the author inserts/removes an unrelated node.

### Label color
With an 8% wash the node stays close to its background, so the label keeps the
theme's `--text-primary` (applied to `.nodeLabel` span for flowchart htmlLabels
and SVG `<text>` for class diagrams). No luminance flip needed at this tint. (If
a future higher-tint mode is added, reintroduce the luminance flip for that mode
only.)

## Where it slots in

`MermaidBlock.tsx`, existing seam:

```
mermaid.render() → sanitizeMermaidSvg() → colorizeDefaultNodes() ★NEW → dangerouslySetInnerHTML
```

The module SVG cache (`_svgCache`) already keys on `(code, theme)` and clears on
theme change, so colorized output caches correctly per theme with no new cache
logic.

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Detection | inline `style` has `fill:` | verified signal, no class parsing |
| Color key | hash(node id) | edit-stable, deterministic |
| Palette | live theme accents (6) | on-brand, auto dark/light per theme |
| Fill style | accent @ 8% wash + full-accent border | soft, not harsh; identity via border |
| Label | keep `--text-primary` | readable on light wash; no flip needed |
| Author nodes | stay full-saturation | pop as emphasis vs soft defaults |
| Parser | DOMParser, not regex | robust attribute handling |
| Scope | flowchart + classDiagram | shared verified shape structure |

## Out of scope / follow-up

- sequence / state / ER / gitGraph diagrams (different DOM; separate change if
  wanted).
- Per-subgraph (cluster) coloring — nodes only for now.
- Configurable palette / user opt-out toggle — ship on-by-default first.

## Risks

- Mermaid DOM structure could shift across major versions → covered by tests
  asserting the detection predicate against fixture SVGs; pin behavior to 11.x.
- Very large diagrams: colorize walks all node groups once — O(n), negligible vs
  render cost. Runs inside existing serialized render queue.
