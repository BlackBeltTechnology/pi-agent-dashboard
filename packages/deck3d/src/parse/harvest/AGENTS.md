# DOX — packages/deck3d/src/parse/harvest

Mermaid → graph IR harvest. Runs only in headless chromium at parse time (design D2).

| File | Purpose |
|------|---------|
| `AGENTS.md` | This file. |
| `shapes.ts` | Pure mermaid→IR enum maps: `mapNodeShape` (`square`→`rect`, `stadium`, `circle`, `doublecircle`, `hexagon`, `diamond`, `cylinder`, unknown→`rect`), `mapEdgeKind` (`thick`/`dotted`/`normal`), `mapMessageKind` (pinned v11 numeric types → `solid`/`dotted` or undefined). Browser-free. |
| `harness.ts` | Browser-side code, bundled by esbuild. `mermaid.initialize` (`theme:base`, `securityLevel:strict`, `htmlLabels:false`, Poppins); semantics from `getDiagramFromText().db` (`getVertices`/`getEdges`/`getSubGraphs`/`getDirection`, `getActors`/`getMessages`), layout from `render()` SVG (`g.node` transform + `getBBox`, `path.flowchart-link` sampled 17 pts via `getPointAtLength`). Matches v11 ids `<renderId>-flowchart-<node>-<n>` / `L_<from>_<to>_<k>`. Exposes `window.__deck3dHarvest(source, renderId)`; `window.__DECK3D_STALL` never resolves. |
| `harness.html` | Inert page shell. `@font-face` Poppins from base64 `__FONT__`, `#mmhost` host, inline `__BUNDLE__`; placeholders are valid JS string literals so Biome can parse the file. |
| `bundle.ts` | `buildHarnessBundle` (esbuild IIFE → `dist/harvest/harness.js`), `getHarnessBundle` (rebuild when missing or older than `harness.ts`), `renderHarnessHtml` (`__BUNDLE__`/`__FONT__`/`__STALL__` substitution, `</script` escaped). |
| `index.ts` | Node driver. `harvestDiagram`: launch chromium `channel:"chromium"`, inject harness, timeout `DECK3D_HARVEST_TIMEOUT_MS` (default 60 s), stall via `DECK3D_HARVEST_STALL=1`, install hint when chromium is missing. `toDiagram` assigns edge ids `<from>-><to>#<k>` + message ids `m<i>`, unsupported type → `kind:"none"` + `warn unsupported diagram <type> slide <id>`. `HarvestError` carries the one-line CLI reason. |
