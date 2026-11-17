# Design

## Context

See proposal.md (Why). Current state:

- Layout is a hand-rolled force loop: seeded LCG (`packages/skill-atlas-plugin/src/client/graph-layout.ts:26-30`), O(n²) pairwise repulsion (`graph-layout.ts:47-60`), 300 fixed iterations, output normalized to [0,1]². It runs once per full graph (`SkillGraphView.tsx:59`), with origin-filtered skills laid out by the full set (`SkillAtlasPage.tsx:252-254`), and never animates. Archived decision Q8 / D9 (`openspec/changes/archive/2026-10-13-add-skill-atlas-screen/design.md:155`).
- Camera = `fitTransform` over normalized space (`graph-layout.ts:105`) plus local zoom/pan. Focus re-fit passes the `hopSet` ids to `fitTransform` (`SkillGraphView.tsx:87`). Zoom and pan reset on every selection or hops change (`SkillGraphView.tsx:79-82`). Escape clears the selection (`SkillGraphView.tsx:104`). A background press starts a pan unless it hits `[data-node]` (`SkillGraphView.tsx:124-134`).
- The page passes the view origin- *and* relation-filtered links (`SkillAtlasPage.tsx:58-63`) plus the unfiltered `allSkills`/`allLinks`.
- Labels: greedy `placeLabels` that always places priority 0, even overlapping (`graph-layout.ts:144`), with a 6.3 px/char width estimate (`graph-layout.ts:141`).
- Origin is encoded by node shape (`SkillGraphView.tsx:31`); the legend sits bottom-left (`SkillGraphView.tsx:210`).
- The e2e budget test P4 marks start, then waits for a node to be *attached* (`tests/e2e/skill-atlas.spec.ts:152-172`).
- i18n catalog: en at call sites; zh-CN and hu keep identical key sets (`packages/skill-atlas-plugin/src/i18n.ts:1-8`).
- `d3-force@3` is present only through mermaid; the plugin lists no d3 dependency (`packages/skill-atlas-plugin/package.json:94`).

The reference prototype is `mockups/2026-11-16-skill-atlas-forest-aura/ForestGraph.tsx` (in this change). It fixes the agreed *feel* (damping, drag, outline, dots, label placement). It is **not** a port source for the rest of the view: it omits search dimming, focus, keyboard walk, zoom buttons, legend, `data-node`/`data-testid`, and i18n, all of which stay as they are in `SkillGraphView`.

## Goals / Non-Goals

**Goals:**
- Add the new behaviour *into* the existing `SkillGraphView`, keeping all main-spec behaviour the delta does not modify.
- Pure helpers stay in `graph-layout.ts` (no DOM, no timers). The stateful simulation lives in a new `atlas-simulation.ts`.

**Non-Goals:**
- **Keyboard forest zoom.** Pointer-only by product decision, an accepted WCAG 2.1.1 exception. Forest zoom adds no information: membership is visible in the Links table and reachable by keyboard via selection plus focus. The outline paths stay non-focusable inside the `role="img"` SVG.
- No server, shared-type, wire, Cards or Links change.
- No persistence of dragged positions.
- No canvas/WebGL; SVG stays (≤ 300 nodes by cap).

## Decisions

### D1 · d3-force simulation in `atlas-simulation.ts` (reverses archived Q8)
- `createAtlasSimulation({ skills, links, forests, prev? })` returns a **stopped** `Simulation`.
- Forces:
  - `randomSource(seeded)`;
  - `forceLink` (references 55/0.7, bundle 70/0.25, shares-tool 55/0.4);
  - `forceManyBody(-110)`;
  - `forceCollide(r+6)`;
  - `forceX`/`forceY` (0.05 / 0.07);
  - `forestSeparation` (D3).
- `presettle(sim)` runs synchronously with `velocityDecay(0.4)` until `alpha < alphaMin`, then switches to `velocityDecay(0.72)` for all visible motion.
  - `alphaDecay` is chosen so cooling takes at most 220 ticks: d3's own "at rest" definition, so a shorter run is still fully settled. This is the budget lever (D10), not a partial layout.
- Node set = **all skills of the graph** (`allSkills`). Simulation links = `allLinks` filtered by the visible *relation types* only, passed as a new `relations` prop from `SkillAtlasPage`. Origin toggles therefore only hide nodes, as today, and never re-layout.
- Two forest sets:
  - *simulation forests* (all skills × relation-visible links) drive `forestSeparation`;
  - *drawn forests* (visible skills × the `links` prop) drive the outlines.
- Each drawn forest is a subset of one simulation forest, so separated simulation discs keep drawn outlines apart.
- `graph-layout.ts` stays pure (no DOM, no timers), but its exported API changes:
  - `layoutGraph` is deleted, with its normalized-space contract;
  - `fitTransform` is replaced by `fitView` (D5);
  - `placeLabels` is replaced (D9).
- The E29 determinism test (`__tests__/graph-layout.test.ts:24`) is replaced by an equivalent test on `presettle` (same graph twice gives identical positions). The file header and its `AGENTS.md` row are updated.

### D2 · Forests from visible links; re-settle on relation change
- `forests(ids, visibleLinks)`: union-find, largest first (pure, in `graph-layout.ts`).
- On a relation-*set* change, the same simulation gets the new link and separation forces, then `alpha(0.35).restart()`.
  - With reduced motion it calls `presettle` instead, and the new layout appears in one step.
- Memos key on the sorted relation set, never on array identity. In the prototype a fresh default array re-ran the layout on every render.
- A graph refetch with a changed fingerprint builds a new simulation seeded from the previous positions of surviving ids and presettles it synchronously. The old SVG stays rendered (the page shows "Updating…") until the new positions are swapped in, with no animation. The spec's determinism exemption covers live updates.

### D3 · `forestSeparation` force: position-based, so it holds at rest
- Each tick, take every forest of 2 or more nodes as a disc (centroid, max node distance + outline pad + node radius).
- For each overlapping pair, add velocity apart along the centre line, scaled by alpha like the built-in forces. Pinned nodes (`fx != null`) are skipped, so a dragged node always stays under the pointer.
- Guarantee scope (spec): no overlap **when the graph opens**. `presettle` keeps ticking at `alphaMin` until the simulation discs are disjoint or 60 extra ticks pass, and a unit test asserts disjointness for the fixture and for 150 two-node forests.
- After drags and relation toggles, separation is best-effort. There is no restart loop, so nothing runs at rest.
- Cost is O(F² + n) per tick. Worst case at the 300-node cap is 150 two-node forests: about 11k disc-pair distance checks, roughly 0.1–0.3 ms per tick.
- Disc ⊇ hull outline, so separate discs mean outlines never intersect. Covered by unit tests on the fixture plus a synthetic worst case.

### D4 · Outline = padded rounded convex hull, drawn in screen space
- `hull(points)` uses monotone chain. `outlinePath(points, pad)` offsets each hull edge by `pad` along its outward normal and joins edges with `A` arcs:
  - 1 point gives a circle;
  - 2 points give a capsule.
- Both are pure and in `graph-layout.ts`.
- Outlines are recomputed per render from current positions.
- Fill: token radial gradient on `--accent-blue` (decoration). Stroke: `--accent-blue-text`, dashed, solid when active. The theme-gallery role contract guarantees it reaches ≥ 4.5:1 on `--bg-primary` in all 18 palettes, and session-header uses the same pattern for its context ring.
- Outlines are a pointer affordance and grouping cue; the Links table stays the text equivalent.

### D5 · Camera: model space + `{k,x,y}`; `fitView` replaces `fitTransform`
- Model space = d3 units, no longer normalized [0,1]².
- `fitView(bounds, viewport, pad, kMax)` is pure and keeps the old "don't blow up 1–3 nodes" cap (`kMax`).
- Bounds of a node set = union of its forest discs, so outlines are never clipped.
- Camera state machine (spec "Graph camera moves only on explicit actions"):
  - auto-fit once at first rest;
  - after that, a new fit only on Fit, focus change, forest zoom enter/exit, or a viewport resize while `userMoved` is false;
  - a resize re-fits the current target (whole graph, focus set, or zoomed forest) while `userMoved` is false;
  - wheel, pan and the zoom in/out buttons set `userMoved`; every explicit fit (Fit, focus change, forest enter/exit) clears it (spec: "since the last of these fits");
  - settles, drags and plain selection never touch the camera. The reset effect at `SkillGraphView.tsx:79-82` is replaced by a fit keyed on the focus set (hops > 0).
- View changes ease over 380 ms, or happen in one step with reduced motion (`matchMedia` read at call time).

### D6 · Zoom to forest and Escape precedence
- One press model for the SVG background and outlines, replacing the `[data-node]` pan guard: a press that moves less than 4 px is a click, otherwise a pan. Clicks:
  - on an outline: zoom to that forest, or switch to it if another forest is zoomed;
  - on empty space: return to the whole graph if zoomed, else nothing;
  - on a node: select it.
- `lostpointercapture` and `pointercancel` end a pan like pointer-up.
- Outline stroke is `--accent-blue-text` at full opacity (≥ 4.5:1 per theme-gallery), with a fill gradient on `--accent-blue` at 0.02–0.12.
- Other forests' nodes and links are dimmed, and their outlines drawn at 0.4. That is below 3:1 by design: de-emphasised context, still clickable to switch. This is a documented trade-off.
- A chip shows "Group: {count} skills" and a real `<button>` "Show all" in the tab order, a keyboard exit independent of SVG focus.
- An outline click calls `svg.focus({ preventScroll: true })`, so Escape reaches the SVG key handler.
- Escape: zoomed → leave zoom (selection kept); not zoomed → clear selection (existing `SkillGraphView.tsx:104`).
- Search dimming and focus dimming compose with forest dimming: a node is dimmed if any of the three says so.

### D7 · Standard d3 drag over React pointer events
- Down on a node: `alphaTarget(0.3).restart()` and pin `fx`/`fy`.
- Move: pointer → model, rAF-batched (≤ 1 state update per frame).
- Up, `pointercancel` or `lostpointercapture`: cancel any pending batched frame, `alphaTarget(0)`, unpin.
- 4 px threshold separates click from drag.
- No `d3-drag`/`d3-selection`: React owns the DOM.

### D8 · Render loop and idle
- `tick` bumps one React state.
- d3's timer stops at `alpha < alphaMin`, so nothing runs at rest.
- On `visibilitychange` → hidden: release any drag, `sim.stop()`, and cancel pending frames. On visible: if `alpha ≥ alphaMin` (not yet at rest), `restart()`; if first rest never happened, finish with `presettle` and run the one-time fit.
- Unmount: `sim.stop()`.
- Memoized: forests, neighbour map, top-degree set, text widths.

### D9 · Labels: four-anchor greedy placement
- Replaces `placeLabels`. Obstacles: placed labels, **every** node box (dimmed included), and the frame.
- Candidate order: hovered, then selected, then the existing label priorities (neighbours, matches, cursor, top degree, all members of a zoomed forest).
- Each candidate tries right, left, below, above, and takes the first free anchor.
- Hovered, then selected: when no anchor is free of nodes, take the first in-frame anchor that clears already-placed labels.
  - The hovered label is first, so it always places. If even the right anchor leaves the frame, it is clamped inside the frame.
  - A selected label with no anchor clear of the hovered one is not drawn while that hover lasts.
- Widths: cached `canvas.measureText` at 11 px system-ui, with the 6.3 px/char fallback when no canvas exists (jsdom).

### D10 · Performance budget
- The reviewer measured the prototype's layout alone at 275–305 ms for 300 nodes, against "layout + first render < 500 ms".
- Levers, in order:
  1. tick cap via `alphaDecay` (D1);
  2. memoized non-positional data;
  3. one render pass for the first paint (the SVG is hidden until settled, then rendered once).
- `performance.mark("atlas-graph-rendered")` moves to the rAF after the **first visible paint** (SVG un-hidden), per graph mount, not per module (`SkillGraphView.tsx:46`, `:74-75`).
- Verified by:
  - a vitest bound on `presettle` at 300 nodes (< 350 ms on the reference machine; the prototype's fixed 300-tick run is not the shipped workload, so the number is re-measured, not inherited);
  - the e2e P4 test measuring `atlas-graph-start` → `atlas-graph-rendered` with `performance.measure`, the archived P4 definition, replacing the `toBeAttached` + rAF proxy (`tests/e2e/skill-atlas.spec.ts:172-179`). The test asserts the mark is emitted only after the SVG is visible.

### D11 · Hollow dots, legible origin marks
- Node radius = `max(5, 4 + √degree)`, capped at 9. This is a little smaller than today's `5 + min(7, 1.6·√degree)`, with the same 5 px minimum.
- Every origin gets the same outline (`--text-secondary`, fill `--bg-primary`).
- Package: filled dot of radius `0.3·r` (≥ 1.5 px) in `--text-secondary`, the same paint as the outline.
- Project: hollow ring of radius `0.62·r` (≥ 3 px), stroke 1.25 in `--accent-green-text`. That is the sanctioned on-surface green (`packages/client/src/index.css:123` dark, `:303` light), text-grade so ≥ 3:1 on `--bg-primary`. It replaces `--accent-green` (2.3:1 on light); `--tint-green-fg` is banned on page surfaces by `message-severity-tokens`.
- Measured contrast for `--accent-green-text` on `--bg-primary`: 8.69:1 (dark), 6.01:1 (light).
- At r = 5 (degree 0 and 1) the ring has radius 3.1 and the dot 1.5, so the ring is visibly hollow and about 2× the dot.
- An invisible r+6 hit circle serves as the pointer target. The legend reuses the dot component.

### D12 · i18n
- New strings get en fallbacks at call sites and matching keys in zh-CN and hu (`i18n.ts`): group chip, Show all, outline title.

### D13 · Dependency
- `d3-force@^3` (dependencies) and `@types/d3-force@^3` (devDependencies) in `packages/skill-atlas-plugin/package.json`, installed with `pnpm install`.
- The check is the declaration itself plus the lockfile importer entry, because resolution already succeeds through hoisting.

## Risks / Trade-offs

- [Budget still tight on slow machines] → D10 levers plus a measured test. If still over, lower the tick cap further; that remains "at rest" by d3's definition.
- [Filters move nodes] → Intended (proposal BREAKING note); damped, and instant with reduced motion.
- [Pointer-only forest zoom] → Product decision, an accepted WCAG 2.1.1 exception. It adds no information beyond the Links table and selection + focus.
- [Bundles engine swap + outlines + drag + labels in one change] → User-directed scope from the mockup loop. Budget and a11y are attributable through separate tests per requirement.
- [jsdom width estimate ≠ rendered width] → The unit test proves non-overlap for the widths it uses. Real fonts are checked in the e2e/visual pass.
- [Reduced-motion preference changed mid-session] → Read at each call; no live subscription needed.

## Migration Plan

Client-only, shipped in the plugin bundle. Rollback = revert. No persisted data.
