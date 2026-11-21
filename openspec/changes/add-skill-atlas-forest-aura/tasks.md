# Tasks

Reference prototype (feel only): `mockups/2026-11-16-skill-atlas-forest-aura/ForestGraph.tsx`. Port behaviour into `SkillGraphView`, keeping every existing behaviour the delta does not modify (search/focus dimming, keyboard walk, zoom buttons, legend, `data-node`/`data-testid`).

## 1. Dependency

- [ ] 1.1 Add `d3-force@^3` to `dependencies` and `@types/d3-force@^3` to `devDependencies` of `packages/skill-atlas-plugin/package.json`, run `pnpm install`, and verify the lockfile importer for the plugin lists both
- [ ] 1.2 Test: dependency declared, in `packages/skill-atlas-plugin/src/client/__tests__/graph-layout.test.ts` (exemplar: same file). Input: plugin package.json; trigger: read it; observable: `dependencies["d3-force"]` and `devDependencies["@types/d3-force"]` both match `^3` (test-plan #X2). Verify it passes

## 2. Pure helpers (graph-layout.ts)

- [ ] 2.1 Add `forests(ids, links)` (union-find, largest first) to `graph-layout.ts` and verify the tests below pass
- [ ] 2.2 Test: forests per connected group (exemplar `__tests__/graph-layout.test.ts`). Input: ids a..l with groups {5},{3},{2} plus 2 singletons; trigger: `forests`; observable: lengths [5,3,2,1,1], each id once (test-plan #E1)
- [ ] 2.3 Test: relation filter re-forms forests (exemplar `__tests__/graph-layout.test.ts`). Input: x–y bundle only, y–z references; trigger: `forests` over references-only vs all; observable: x singleton then {x,y,z} together (test-plan #E2)
- [ ] 2.4 Add `hull` + `outlinePath(points, pad)` to `graph-layout.ts`; Test (exemplar `__tests__/graph-layout.test.ts`): input 1, 2, 3-collinear and 6 seeded points; trigger `outlinePath(points, 20)` sampled to a polygon; observable: circle r=20 / capsule / capsule / every point ≥ 19.5 px inside (test-plan #E3). Verify it passes
- [ ] 2.5 Add `fitView(bounds, viewport, pad, kMax)` replacing `fitTransform`, update the existing fit test at `__tests__/graph-layout.test.ts:64`, and verify it passes
- [ ] 2.6 Replace `placeLabels` with the 4-anchor placer (measured widths, cached; fallback 6.3 px/char + 2; obstacles = all node boxes + placed labels + frame; hovered then selected first, may cover nodes, hovered clamped in frame) per design D9, replacing the test at `__tests__/graph-layout.test.ts:46`, and verify the tests below pass
- [ ] 2.7 Test: dense cluster labels (exemplar `__tests__/graph-layout.test.ts`). Input: 17 candidates on a 6×3 grid spaced 18 px, frame 400×300, r=5; trigger: `placeLabels`; observable: no box intersections, no non-hovered/selected box over a node, all inside frame (test-plan #E7)
- [ ] 2.8 Test: hovered first, may cover a node (exemplar `__tests__/graph-layout.test.ts`). Input: hovered node with all anchors blocked by nodes plus a selected neighbour that only collides with it; trigger: `placeLabels`; observable: hovered box returned, selected absent (test-plan #E8)
- [ ] 2.9 Test: hovered label clamped at frame edge (exemplar `__tests__/graph-layout.test.ts`). Input: hovered node at x = frame.w − 2 with a 120 px label; trigger: `placeLabels`; observable: box fully inside frame (test-plan #E9)
- [ ] 2.10 Test: no canvas fallback (exemplar `__tests__/graph-layout.test.ts`). Input: `getContext` stubbed to return null; trigger: `placeLabels` with 3 candidates; observable: no throw, widths = 6.3·len + 2, no overlaps (test-plan #X1)
- [ ] 2.11 Update `graph-layout.ts` header and its row in `packages/skill-atlas-plugin/src/client/AGENTS.md` (`layoutGraph`/`fitTransform` removed; `forests`, `outlinePath`, `fitView`, `placeLabels` contract; `See change: add-skill-atlas-forest-aura`) and verify the row exists

## 3. Simulation (atlas-simulation.ts)

- [ ] 3.1 Create `packages/skill-atlas-plugin/src/client/atlas-simulation.ts`: `createAtlasSimulation` (stopped, seeded, forces per design D1, `forestSeparation` per D3 skipping pinned nodes) and `presettle` (velocityDecay 0.4 to rest with an `alphaDecay` tick cap ≤ 220, extra ticks at alphaMin until discs are disjoint or +60, then velocityDecay 0.72); delete `layoutGraph`; add an AGENTS.md row; verify the tests below pass
- [ ] 3.2 Test: determinism replaces E29 (exemplar `__tests__/graph-layout.test.ts:24`). Input: 49-skill fixture (copy `graph.fixture.json` into `__tests__/fixtures/`); trigger: `presettle` in two fresh simulations; observable: identical x,y per node (test-plan #E5)
- [ ] 3.3 Test: no outline overlap on open (exemplar `__tests__/graph-layout.test.ts`). Input: (a) the fixture, (b) 150 two-skill forests; trigger: `createAtlasSimulation` + `presettle`; observable: separation discs of drawn forests pairwise disjoint (test-plan #E4)
- [ ] 3.4 Test: presettle budget (exemplar `__tests__/graph-layout.test.ts:38`). Workload: 300 skills, 300 links incl. 150 two-node forests; metric: `presettle` median of 3 runs < 350 ms (test-plan #P1)
- [ ] 3.5 Test: pinned node ignores separation (exemplar `__tests__/graph-layout.test.ts`). Input: a pinned node held inside another forest's disc; trigger: 20 ticks; observable: its x,y equal the pin every tick (test-plan #F13)

## 4. Graph view (SkillGraphView.tsx + SkillAtlasPage.tsx)

- [ ] 4.1 Hollow dots with origin inner marks (design D11; tokens `--text-secondary`, `--bg-primary`, `--accent-green-text`; radius `max(5, 4 + √degree)` capped 9), reused in the legend; Test (exemplar `__tests__/atlas-ui.test.tsx`): input one Global/Package/Project at degree 0; trigger render; observable: one outline r=5 each, Global no inner element, Package filled r=1.5 `var(--text-secondary)`, Project ring r≈3.1 stroke `var(--accent-green-text)` (test-plan #E6). Verify it passes
- [ ] 4.2 Persistent simulation in the view: pass a `relations` prop from `SkillAtlasPage`; simulation = all skills × relation-visible links; drawn forests = visible skills × `links`; tick → one state bump; relation-set change → re-settle (`alpha(0.35)`, or `presettle` with reduced motion); refetch → presettle seeded from surviving positions, old SVG kept until swap; hidden until first rest; `atlas-graph-rendered` mark after first visible paint, per mount. Verify the tests below and the existing `atlas-ui.test.tsx` suite pass
- [ ] 4.3 Test: origin toggle does not re-layout (exemplar `__tests__/atlas-ui.test.tsx`). Input: graph at rest; trigger: toggle origin Package off; observable: remaining node positions unchanged, no restart (test-plan #F11)
- [ ] 4.4 Test: live update keeps old graph until swap (exemplar `__tests__/atlas-ui.test.tsx` live-update case). Input: rendered graph + refetch adding one skill; trigger: live update; observable: old nodes rendered until swap, then new node present and survivors start at previous positions (test-plan #F12)
- [ ] 4.5 Camera state machine (design D5): fit once at first rest; refit on Fit, focus change, forest enter/exit, resize while `userMoved` false; wheel/pan/zoom buttons set `userMoved`, explicit fits clear it; remove the selection reset at `SkillGraphView.tsx:79-82`. Verify the tests below pass
- [ ] 4.6 Test: resize refits until user zooms (exemplar `__tests__/atlas-ui.test.tsx`, ResizeObserver stub). Input: 800×600; trigger: resize 1000×700, wheel-zoom, resize 900×600; observable: first resize refits, second leaves transform unchanged (test-plan #E13)
- [ ] 4.7 Test: Fit clears userMoved (exemplar `__tests__/atlas-ui.test.tsx`). Input: panned 50 px; trigger: Fit then resize; observable: transform equals a fresh fit (test-plan #E14)
- [ ] 4.8 Test: selection keeps the camera (exemplar `__tests__/atlas-ui.test.tsx`). Input: focus All, A selected, transform T; trigger: select B; observable: transform T (test-plan #E15)
- [ ] 4.9 Test: focus change refits (exemplar `__tests__/atlas-ui.test.tsx`). Input: skill selected, focus All; trigger: 1 hop; observable: transform fits the hop set (test-plan #E16)
- [ ] 4.10 Test: re-settle keeps the camera (exemplar `__tests__/atlas-ui.test.tsx`). Input: at rest, transform T; trigger: toggle `bundle` off, tick to rest; observable: transform T at every tick (test-plan #F8)
- [ ] 4.11 Forest outlines + zoom (design D4/D6): outline layer under links; one press model for background and outlines (< 4 px = click, else pan; cancel/lost capture end a pan); click outline → zoom/switch; empty-space click returns; chip with real "Show all" `<button>`; svg refocus on outline click; Escape leaves zoom before clearing selection. Verify the tests below pass
- [ ] 4.12 Test: outline click vs pan (exemplar `__tests__/atlas-ui.test.tsx`). Input: unzoomed; trigger: press on an outline, move 3 px vs 30 px; observable: chip shown vs view translated (30,0) and no chip (test-plan #E11)
- [ ] 4.13 Test: switch forest (exemplar `__tests__/atlas-ui.test.tsx`). Input: forest A zoomed; trigger: click B's outline; observable: chip shows B's size, A dimmed, B not (test-plan #E12)
- [ ] 4.14 Test: Escape order (exemplar `__tests__/atlas-ui.test.tsx:163`). Input: selected skill, its forest zoomed; trigger: Escape twice on the svg; observable: 1st clears zoom and keeps selection, 2nd `onSelect(null)` (test-plan #F1)
- [ ] 4.15 Test: Escape after a pointer zoom (exemplar `__tests__/atlas-ui.test.tsx`). Input: outline clicked; trigger: Escape on `document.activeElement`; observable: active element is the svg and the chip is gone (test-plan #F2)
- [ ] 4.16 Test: Show all keyboard-reachable (exemplar `__tests__/atlas-ui.test.tsx`). Input: forest zoomed; trigger: query + activate the chip button; observable: `<button>` without negative tabIndex, chip removed (test-plan #F3)
- [ ] 4.17 Test: click empty space returns (exemplar `__tests__/atlas-ui.test.tsx`). Input: forest zoomed; trigger: press/release on background < 4 px; observable: chip removed, no forest dimming (test-plan #F4)
- [ ] 4.18 Standard d3 drag (design D7): pin on down + `alphaTarget(0.3)`, rAF-batched moves, release/cancel/lost-capture unpin + `alphaTarget(0)` + cancel pending frame, 4 px click threshold. Verify the tests below pass
- [ ] 4.19 Test: click vs drag threshold (exemplar `__tests__/atlas-ui.test.tsx`). Input: rendered graph; trigger: press a node, move 3 px vs 4 px, release; observable: 3 px selects once and never pins, 4 px pins and does not select (test-plan #E10)
- [ ] 4.20 Test: neighbours follow a drag (exemplar `__tests__/atlas-ui.test.tsx`). Input: node with two neighbours at rest; trigger: drag 60 px right, 30 ticks; observable: node `fx` at target, both neighbours' x increased (test-plan #F5)
- [ ] 4.21 Test: release settles gradually (exemplar `__tests__/atlas-ui.test.tsx`). Input: node dragged 60 px; trigger: release, step ticks; observable: `fx` null, distance to rest decreases monotonically over ≥ 3 ticks (test-plan #F6)
- [ ] 4.22 Test: cancelled pointer releases (exemplar `__tests__/atlas-ui.test.tsx`). Input: drag in progress; trigger: `pointercancel`, and separately `lostpointercapture`; observable: unpinned, `alphaTarget` 0, no pending rAF (test-plan #F7)
- [ ] 4.23 Reduced motion + idle (design D5/D8): `matchMedia` at call time; `visibilitychange` stop/resume. Verify the tests below pass
- [ ] 4.24 Test: reduced motion (exemplar `__tests__/atlas-ui.test.tsx`). Input: `matchMedia` reduce → true; trigger: outline click, relation toggle; observable: forest fit in the same render, positions jump to presettled values with no intermediate ticks rendered (test-plan #F9)
- [ ] 4.25 Test: idle at rest / hidden (exemplar `__tests__/atlas-ui.test.tsx`, fake timers). Input: graph at rest, then settling with document hidden; trigger: 500 ms fake time, then visible; observable: 0 rAF/ticks at rest, ticks stop while hidden and resume on visible until rest (test-plan #F10)
- [ ] 4.26 Add i18n keys (group chip, Show all, outline title) to zh-CN and hu in `packages/skill-atlas-plugin/src/i18n.ts` with en fallbacks at call sites; Test (exemplar `__tests__/atlas-ui.test.tsx`): input the catalog; trigger compare key sets; observable: zh-CN and hu identical and containing the 3 new keys (test-plan #X3). Verify it passes
- [ ] 4.27 Update the `SkillGraphView.tsx` + `SkillAtlasPage.tsx` rows in `packages/skill-atlas-plugin/src/client/AGENTS.md` and verify they exist; delegate the `docs/skill-atlas.md` graph description update (dots, outlines, zoom, drag) to DocScribe and verify the doc mentions forest outlines

## 5. End-to-end budget

- [ ] 5.1 Test: P4 measures to the rendered mark (exemplar `tests/e2e/skill-atlas.spec.ts:152`). Workload: existing 300-skill P4 fixture; metric: `performance.measure("atlas-graph-start" → "atlas-graph-rendered")` < 500 ms and the svg is `visibility: visible` when the mark fires, replacing the `toBeAttached` + rAF proxy (test-plan #P2). Verify it passes against the docker harness (`run-dashboard-e2e-local-changes`)

## 6. Integration

- [ ] 6.1 Run `npm test` piped to `/tmp/pi-test.log` and verify no skill-atlas failures and that `node scripts/theme-token-guard.mjs` reports no new violation
- [ ] 6.2 Manual (test-plan: manual-only): in an isolated dashboard build (not :8000), base dark + light, judge that motion feels slow and calm, outlines read as groups, and origin marks are distinguishable at default zoom (test-plan #F14)

## Workflow follow-up

- Run `ship-it` in the worktree; `ship-change` archives and syncs the `skill-atlas` spec.
