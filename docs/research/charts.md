# Explore: Diagram Renderers & Inline Charts

*Captured from explore session — 2026-04-04*

## Goal

Add more diagram renderers (like PlantUML) beyond Mermaid, and add inline chart support — potentially rendering charts from markdown tables.

---

## Current State

`MarkdownContent.tsx` intercepts fenced code blocks with `language-mermaid` and routes them to `MermaidBlock.tsx`, which has:
- Serialized render queue (Mermaid uses global state)
- SVG caching
- Zoom/pan support
- Code sanitization
- Theme-aware rendering

The pattern is clean — adding new diagram languages means adding new `if (match[1] === "xxx")` branches + corresponding renderer components.

Currently only dependency: `mermaid ^11.13.0`.

---

## Diagram Renderers Worth Considering

| Format | Library | How it works | Bundle size | LLM support |
|--------|---------|-------------|-------------|-------------|
| **Mermaid** | `mermaid` | JS → SVG | ~2.5MB | ✅ Excellent — all major LLMs know it well |
| **PlantUML** | `plantuml-encoder` + public server | Encodes → URL → `<img>` to plantuml.com | Tiny (encoder only) | ✅ Very good — classic format |
| **PlantUML** (offline) | `plantuml/plantuml-wasm` (official) | Java→WASM, runs in browser | **~15-20MB** WASM blob | ✅ |
| **Graphviz/DOT** | `@hpcc-js/wasm-graphviz` | C→WASM, dot/neato/etc | ~3MB WASM | ✅ Good — DOT is well-known |
| **D2** | No browser runtime | Go binary, server-side only | N/A | 🟡 Moderate |
| **Excalidraw** | `@excalidraw/excalidraw` | React component | ~1MB | ❌ JSON format, not text |
| **Nomnoml** | `nomnoml` | JS → SVG, UML class diagrams | ~50KB | 🟡 Less known |
| **Svgbob** | `svgbob-wasm` | Rust→WASM, ASCII art → SVG | ~200KB | ❌ Niche |
| **Tikz/LaTeX** | No good browser option | Needs LaTeX engine | N/A | ✅ but not renderable |
| **Ditaa** | No standalone JS | Java-based | N/A | 🟡 |

## Inline Chart Libraries

For rendering charts from markdown tables or code blocks:

| Library | Approach | Bundle | Notes |
|---------|----------|--------|-------|
| **Chart.js** | Canvas-based | ~200KB | Most popular, simple API |
| **Recharts** | React + SVG (built on D3) | ~400KB | Declarative, React-native |
| **Vega-Lite** | Declarative JSON spec → SVG | ~800KB | Grammar of graphics, very expressive |
| **Observable Plot** | D3-based, concise API | ~300KB | Modern, composable |
| **ECharts** | Canvas/SVG | ~1MB | Feature-rich, CJK-friendly |
| **Plotly.js** | SVG + Canvas | **~3.5MB** | Most features, heaviest |
| **uPlot** | Canvas, time-series focused | ~35KB | Tiny, fast, limited chart types |
| **Frappe Charts** | SVG, minimal | ~50KB | Simple, GitHub-inspired |

---

## Architecture Sketch

```
                    ┌─────────────────────────────────┐
                    │     CODE BLOCK DETECTION        │
                    │  ```plantuml  ```dot  ```chart  │
                    └──────────┬──────────────────────┘
                               │
              ┌────────────────┼────────────────┐
              ▼                ▼                 ▼
        ┌──────────┐    ┌──────────┐     ┌───────────┐
        │ PlantUML │    │ Graphviz │     │   Chart   │
        │ Renderer │    │ Renderer │     │  Renderer │
        └──────────┘    └──────────┘     └───────────┘
              │                │                 │
              ▼                ▼                 ▼
         ┌─────────────────────────────────────────┐
         │  Same wrapper: zoom/pan, error fallback │
         │  (extract from MermaidBlock → shared)   │
         └─────────────────────────────────────────┘
```

---

## Key Design Questions

### 1. PlantUML: Server vs WASM?

- **Server approach** (plantuml.com or self-hosted): Tiny client, but requires network. Privacy concern — diagram content sent externally. Could proxy through dashboard server.
- **WASM approach**: Fully offline, but **15-20MB download**. Could lazy-load.
- **Hybrid**: Try local WASM first, fall back to server?

### 2. Chart rendering: What input format?

- **Option A**: `chart` code block with a simple DSL (YAML/JSON config)
  ```
  type: bar
  data:
    labels: [Mon, Tue, Wed]
    values: [10, 20, 15]
  ```
- **Option B**: Auto-detect markdown tables that "look like chart data" and offer a toggle button (table ↔ chart). The `TableWrapper` component already exists with copy buttons — a "visualize" icon could be added.
- **Option C**: Vega-Lite JSON in `vega-lite` blocks — LLMs know Vega-Lite well.

### 3. Bundle size concern

Mermaid is already ~2.5MB. Adding WASM-Graphviz (~3MB) + PlantUML-WASM (~15MB) + a chart lib could balloon the bundle. **Lazy loading is essential.**

---

## Recommendations

### Tier 1 — High value, practical
- **Graphviz/DOT** via `@hpcc-js/wasm-graphviz` — LLMs generate DOT well, ~3MB WASM lazy-loaded, covers dependency graphs/state machines that Mermaid handles poorly
- **Chart.js** or **Recharts** for inline charts — both are React-friendly, moderate size
- **Table-to-chart toggle** — detect numeric tables and add a chart icon button next to the existing copy buttons in `TableWrapper`

### Tier 2 — Nice to have
- **PlantUML** via server proxy (encode + proxy through dashboard server to plantuml.com or configurable server URL) — avoids the 15MB WASM blob
- **Vega-Lite** blocks — LLMs know the format, very expressive

### Tier 3 — Skip
- D2 (no browser runtime)
- Excalidraw (not text-based)
- Full PlantUML WASM (too heavy)

---

## Open Threads

1. **Table-to-chart idea** — The `TableWrapper` already exists with copy buttons. Adding a "visualize" toggle button that renders the table data as a chart could be very slick. What chart types would matter most?

2. **PlantUML rendering strategy** — Server proxy vs WASM vs skip entirely? PlantUML is popular but the browser story is rough.

3. **Should this be one change or two?** Diagrams and charts are fairly independent features.
