# Test Plan — add-skill-atlas-forest-aura

Stage: design   Generated: 2026-11-16

Hard gate passed: every Triple below is concrete from spec.md / design.md (pad 20 px, 4 px click threshold, damping 0.72, presettle < 350 ms, P4 < 500 ms, measured contrast). No clarifications open.

Harness exemplars:
- L1 pure: `packages/skill-atlas-plugin/src/client/__tests__/graph-layout.test.ts`
- L1 component (jsdom, `fireEvent`, ResizeObserver stub): `packages/skill-atlas-plugin/src/client/__tests__/atlas-ui.test.tsx`
- L3: `tests/e2e/skill-atlas.spec.ts` (P4 at `:152`)

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Forest outlines: outline per connected group | EP | L1 | automated | ids a..l; links forming groups {5},{3},{2} + 2 singletons | `forests(ids, links)` | returns 5 arrays with lengths [5,3,2,1,1] in that order; every id appears exactly once |
| E2 | Forest outlines: relation filter re-forms forests | decision-table | L1 | automated | skills x,y joined only by a `bundle` link, plus a `references` link y–z | `forests` over links filtered to `references` only | x is a singleton; y and z share a forest; with all relations x,y,z share one forest |
| E3 | Forest outlines: outline encloses nodes (hull geometry) | BVA | L1 | automated | point sets of size 1, 2, 3 collinear, 6 random (seeded) | `outlinePath(points, 20)` parsed to a polygon (arcs sampled) | 1 point → circle path of radius 20; 2 → capsule; collinear 3 → capsule over the endpoints; every input point lies ≥ 19.5 px inside the outline |
| E4 | Forest outlines: no overlap on open | invariant | L1 | automated | (a) bundled 49-skill fixture `graph.fixture.json`; (b) 150 two-skill forests | `createAtlasSimulation` + `presettle` | for every pair of drawn forests (≥ 2 nodes) the separation discs (centroid, max dist + 20 + node r) are disjoint |
| E5 | Atlas views: determinism | invariant | L1 | automated | 49-skill fixture, all relations | `presettle` run twice in fresh simulations | every node's x,y identical between runs (replaces E29 `graph-layout.test.ts:24`) |
| E6 | Atlas views: origin by inner mark | EP | L1 | automated | one Global, one Package, one Project skill, degree 0 (r = 5) | render `SkillGraphView` | each `data-node` has one outline circle r=5; Global has no inner element; Package has a filled circle r=1.5 with fill `var(--text-secondary)`; Project has an unfilled circle r≈3.1 with stroke `var(--accent-green-text)` |
| E7 | Labels never overlap: dense cluster | invariant | L1 | automated | 17 candidates on a 6×3 grid spaced 18 px, frame 400×300, node r=5, widths via fallback | `placeLabels` | no two returned boxes intersect; no non-hovered/selected box intersects any node box; every box inside the frame |
| E8 | Labels: hovered first, may cover a node | BVA | L1 | automated | hovered node with all 4 anchors blocked by nodes; a selected neighbour whose anchors all collide with the hovered label | `placeLabels` | hovered box returned (inside frame, may intersect a node, no other label); selected label absent |
| E9 | Labels: hovered label clamped at frame edge | BVA | L1 | automated | hovered node at x = frame.w − 2 with a 120 px label | `placeLabels` | returned box fully inside the frame |
| E10 | Draggable nodes: click vs drag threshold | BVA | L1 | automated | rendered graph | pointerDown on a node, move 3 px vs 4 px, pointerUp | 3 px: `onSelect(id)` called once, node not pinned; 4 px: no select, node was pinned (`fx` set) during move |
| E11 | Zoom to a forest: outline click vs pan | BVA | L1 | automated | rendered graph, unzoomed | pointerDown on an outline, move 3 px vs 30 px, pointerUp | 3 px: chip "Group: N skills" shown; 30 px: view translated by (30,0), no chip |
| E12 | Zoom to a forest: switch forest | state-transition | L1 | automated | forest A zoomed | click forest B's outline | chip shows B's size; A's nodes dimmed (opacity < 1), B's not |
| E13 | Camera: resize refits until user pans | state-transition | L1 | automated | rendered graph at 800×600 | resize to 1000×700; then wheel-zoom; then resize to 900×600 | first resize changes the transform to the new fit; after the zoom, the second resize leaves the transform unchanged |
| E14 | Camera: Fit clears userMoved | state-transition | L1 | automated | graph panned by 50 px | click Fit, then resize | transform after resize equals a fresh fit at the new size |
| E15 | Camera: selection keeps the camera | state-transition | L1 | automated | focus All, skill A selected, transform T | select skill B | transform still T (regression on `SkillGraphView.tsx:79-82`) |
| E16 | Camera: focus change refits | state-transition | L1 | automated | skill selected, focus All | set focus 1 hop | transform changes so the hop set's bounds fit the viewport |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | Atlas performance budget (layout share) | threshold (timed) | L1 | automated | 300 synthetic skills, 300 links incl. 150 two-node forests | `presettle` wall time < 350 ms (median of 3 runs) | single test |
| P2 | Atlas performance budget (end to end) | threshold | L3 | automated | 300-skill fixture (existing P4 setup) | `performance.measure("atlas-graph-start" → "atlas-graph-rendered")` < 500 ms, and at mark time the SVG `visibility` is `visible` | one Graph-tab activation |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | Zoom to a forest: Escape order | state-transition | L1 | automated | skill selected, its forest zoomed by outline click | keyDown Escape on the svg, twice | after 1st: no chip, no forest dimming, selection kept; after 2nd: `onSelect(null)` |
| F2 | Zoom: Escape after a pointer zoom | state-transition | L1 | automated | outline clicked (no other click) | Escape dispatched to `document.activeElement` | `document.activeElement` is the graph svg and the chip disappears |
| F3 | Zoom: Show all is keyboard-reachable | EP | L1 | automated | forest zoomed | query the chip | "Show all" is a `<button>` with no negative tabIndex; activating it removes the chip |
| F4 | Zoom: click empty space returns | state-transition | L1 | automated | forest zoomed | pointerDown/Up on svg background, < 4 px | chip removed; no node dimmed by forest |
| F5 | Draggable nodes: neighbours follow | convergence | L1 | automated | node n with two linked neighbours; graph at rest | drag n 60 px right, run 30 ticks | n at the pointer (`fx` = target); both neighbours' x increased |
| F6 | Draggable nodes: release settles gradually | convergence | L1 | automated | node dragged 60 px from rest | pointerUp, step ticks | `fx` is null; distance to the final rest position decreases monotonically over ≥ 3 ticks (no single-tick arrival) |
| F7 | Draggable nodes: cancelled pointer releases | fault-injection (abort) | L1 | automated | drag in progress | dispatch `pointercancel` (and separately `lostpointercapture`) | node unpinned, `alphaTarget` 0, no pending rAF |
| F8 | Forest re-settle keeps the camera | invariant | L1 | automated | graph at rest, transform T | toggle the `bundle` relation off, run ticks to rest | transform equals T at every tick |
| F9 | Reduced motion | decision-table | L1 | automated | `matchMedia('(prefers-reduced-motion: reduce)')` → true | click an outline; toggle a relation | transform reaches the forest fit in the same render; positions jump to presettled values with no intermediate ticks rendered |
| F10 | Idle when at rest / hidden | invariant | L1 | automated | graph at rest; then a settling graph with the document hidden | spy `requestAnimationFrame` + simulation tick count | at rest: 0 rAF / ticks over 500 ms of fake time; hidden while settling: ticks stop; on visible again: resumes until rest |
| F11 | Origin toggle does not re-layout | invariant | L1 | automated | graph at rest | toggle origin Package off | positions of remaining nodes unchanged; no simulation restart |
| F12 | Live update keeps the old graph until swap | state-transition | L1 | automated | graph rendered; refetch returns a graph with one added skill | trigger the live update | old nodes stay rendered until the swap; after the swap the new skill has a node and surviving nodes start from previous positions |
| F13 | Pinned node ignores forest separation | invariant | L1 | automated | dragged node held inside another forest's disc | run 20 ticks | pinned node's x,y equal the pointer target every tick |
| F14 | Feel: damping, outline look, dot legibility in base dark + light | visual/subjective | — | manual-only | built client, isolated dashboard instance | human drags, zooms, toggles | [judgment: motion feels slow and calm, outlines read as groups, origin marks distinguishable at default zoom] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Labels: no canvas (jsdom / measure failure) | fault-injection (abort) | L1 | automated | `document.createElement('canvas').getContext` returns null | `placeLabels` with 3 candidates | widths fall back to 6.3 px/char + 2; no throw; boxes non-overlapping |
| X2 | Dependency is declared | invariant | L1 | automated | plugin `package.json` | read the file | `dependencies["d3-force"]` matches `^3` and `devDependencies["@types/d3-force"]` matches `^3` |
| X3 | i18n: catalogs stay in sync | invariant | L1 | automated | `src/i18n.ts` catalog | compare key sets | zh-CN and hu key sets are identical and include the new group-chip, show-all and outline-title keys |

---

## Coverage summary

- Requirements covered: 8/8 delta requirements (Atlas views, Forest outlines, Zoom to a forest, Draggable nodes, Camera, Motion/idle, Labels) + Atlas performance budget (main)
- Scenarios by class: edge 16 · perf 2 · frontend 14 · error 3
- Scenarios by level: L1 33 · L2 0 · L3 1 · — 1
- Scenarios by disposition: automated 34 · manual-only 1

## New infra needed

- none (`atlas-ui.test.tsx` already stubs ResizeObserver; `matchMedia` and `getContext` are stubbed per test)
