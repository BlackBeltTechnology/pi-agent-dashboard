# Proposal

## Why

The Skill Atlas Graph view draws its clusters as unbounded node clouds, with a static hand-rolled layout. Users cannot tell where one group of related skills ends and the next begins, and cannot zoom into one group without fiddling with wheel and pan. Square and diamond node shapes also make dense clusters noisy. A live, damped d3-force layout with an outline around each group (forest) and click-to-zoom makes the graph readable and explorable, without new screens or server changes.

## What Changes

- Graph layout moves from the hand-rolled force loop to **`d3-force`**. The initial layout is seeded and pre-settled off-screen, so it appears without a fly-in and stays deterministic. After that the simulation stays alive with heavy damping.
- **Forest outlines.** Each connected component of 2 or more skills, computed over the *visible* (relation-filtered) links, is wrapped in a rounded, padded convex-hull outline (aura) that follows its nodes. A custom force keeps outlines from overlapping. Single skills get no outline.
- **Click an outline to zoom** (pointer). The view animates to fit that forest, and other forests dim. Esc, a "Show all" chip, or a click outside the forest returns to the whole graph. Forest zoom is pointer-only by decision.
- **Calm camera.** The view fits once at first rest, then moves only on explicit actions (pan, zoom, Fit, focus, forest zoom, a resize before any pan or zoom); plain selection no longer resets it. Reduced motion makes re-settles and view changes instant. Nothing runs at rest or while the page is hidden.
- **Standard d3 drag.** Dragging pins the node to the cursor while neighbours follow through link forces. On release the node is unpinned and settles slowly.
- **Relation filters reshape forests.** Toggling a relation type recomputes forests and visibly re-settles the graph (damped). **BREAKING (behaviour):** filters no longer leave node positions untouched.
- **Nodes become hollow dots.** Every origin has the same circle outline, and origin is shown by what is inside it: Global empty, Package a filled centre dot, Project a green inner ring. Cards and Links keep their existing origin cues.
- New strings are added to the plugin i18n catalog (en, zh-CN, hu).
- `docs/skill-atlas.md` and the plugin `AGENTS.md` rows are updated for the new graph.
- **Labels never overlap.** Each label tries four anchors (right, left, below, above), avoiding other labels, dots and the frame edge. A label that fits nowhere is hidden and shown on hover.
- Adds `d3-force` (+ `@types/d3-force`) as a direct dependency of `@blackbelt-technology/pi-dashboard-skill-atlas-plugin`. It is resolvable today only transitively, through mermaid.
- Mockup: mockups/2026-11-16-skill-atlas-forest-aura (in this change)

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `skill-atlas`: The "Atlas views" requirement changes. Origin is encoded by the node's inner mark instead of node shape. Determinism applies to the initial layout. New behaviour is added for forest outlines, zoom-to-forest, drag, and non-overlapping labels. The "Atlas performance budget" requirement is unchanged; its 300-node layout + first-render budget (< 500 ms) now applies to the d3-force pre-settle.

## Impact

- **Code:** `packages/skill-atlas-plugin/src/client/graph-layout.ts` (pure helpers: forests, hull outline, fit, label placement), new `atlas-simulation.ts` (d3-force simulation), `SkillGraphView.tsx` (outline layer, zoom-to-forest, drag, camera, dots, legend) and `src/i18n.ts`. Client only; no server, shared-type, or wire change.
- **Tests:** `src/client/__tests__/graph-layout.test.ts`, `atlas-ui.test.tsx`, and the e2e budget test `tests/e2e/skill-atlas.spec.ts` (P4 waits for a visible graph).
- **Dependencies:** `d3-force@^3` + `@types/d3-force` in the plugin `package.json`. The plugin is published, so the dependency must be explicit.
- **Supersedes** archived design decision Q8 / D9 of `add-skill-atlas-screen` ("hand-rolled force, no dependency, no animation tick").

## Discipline Skills

- `performance-optimization`: the spec sets a 300-node layout + first-render budget (< 500 ms), and this change replaces the layout engine and adds a per-tick render loop, so the budget must be measured, not assumed.
- `review-code`: non-trivial client change (engine swap + interaction model); inline review before commit.
