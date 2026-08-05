## 0. dnd-kit integration spike — DONE (results in design D5c)

- [x] 0.1 Resolved D5c by spike: parent of `<DndContext>` sees `droppableRects.size = 0` at mount and at drag start; a child using `useDndContext()` + `useDndMonitor()` sees 19 rects / 17 card containers. **Option (c) chosen** — headless probe child, additive, board shape unchanged.
- [x] 0.2 Pinned `pointerY = activatorEvent.clientY + delta.y` — measured 314.4 derived vs 314.4 real, 0px error.
- [x] 0.3 Auto-scroll investigated: real-pointer drag to the bottom edge scrolls the body 0 → 305 (max). `over` can be the body (19/114 sampled y positions), but the gap-only stall is self-correcting and was not reproducible. Downgraded to an assertion (see 6.16).
- [x] 0.4 Outcomes recorded in `design.md` D5c and the Risks section.
- [x] 0.5 Spike and mockup relocated under the change as `spike/` and `mockup/`, so the evidence travels with the proposal instead of rotting in a shared scratch directory. Run the spike with `npx vite openspec/changes/fix-openspec-board-drop-targeting/spike` (vite resolves `node_modules` from the repo root); serve the mockup with any static server. Both are archived with the change — no separate cleanup decision is owed.
- [ ] 0.6 If `spike/` proves useful as a Playwright fixture during section 6, promote it into `tests/e2e/`; otherwise leave it archived as evidence.

## 1. L1 tests — write first, watch them fail

All rows below are folded from `test-plan.md`. Harness exemplar for every L1 row: **see `packages/client/src/lib/__tests__/openspec-board-order.test.ts`** (same module, same vitest setup).

- [ ] 1.1 Slot resolution, pointer just above a midpoint — column `[a,b,c]` dragging `X` from another column · pointer 1px above `b`'s midpoint · resolves `index === 1` (test-plan #E1)
- [ ] 1.2 Slot resolution, pointer exactly at a midpoint — same column · pointer exactly at `b`'s midpoint · resolves `index === 2`, tie breaks *after* (test-plan #E2)
- [ ] 1.3 Slot resolution, pointer just below a midpoint — same column · pointer 1px below `b`'s midpoint · resolves `index === 2` (test-plan #E3)
- [ ] 1.4 Last slot reachable — column `[a,b,c]` · pointer 1px below `c`'s midpoint · resolves `index === 3` (test-plan #E4)
- [ ] 1.5 First slot reachable — column `[a,b,c]` · pointer above `a`'s midpoint · resolves `index === 0` (test-plan #E5)
- [ ] 1.6 Empty column — no cards · pointer anywhere in body · resolves `index === 0`, no throw (test-plan #E6)
- [ ] 1.7 Single-card column — `[a]` · pointer below `a`'s midpoint · resolves `index === 1` (test-plan #E7)
- [ ] 1.8 Direction and scope independence — column `[a,b,c,d]`, gap between `b` and `c` · resolve for dragged-up-from-`d`, dragged-down-from-`a`, and cross-column · all three return the same index (test-plan #E8)
- [ ] 1.9 Moved card excluded from the count — same-column drag of `b` in `[a,b,c,d]` · resolve · index is into the without-moved list, moved card not counted (test-plan #E9)
- [ ] 1.10 Adjacent drag is not a no-op — `[a,b,c,d]` dragging `b` · pointer below `c`'s midpoint, feed to `computeReorder` · yields `[a,c,b,d]`, not `[a,b,c,d]` (test-plan #E10)
- [ ] 1.11 `computeReorder` needs no caller adjustment — outputs of 1.1–1.9 · fed directly to `computeReorder` · correct order with no `+1` applied by the caller (test-plan #E11)
- [ ] 1.12 Marker host translation, same column — drag `b` in `[a,b,c]`, without-index `1` · map to rendered index · host is `c`, never the dragged card `b` (test-plan #E12)
- [ ] 1.13 Marker host translation, cross column — drop into `[a,b,c]`, without-index `1` · map to rendered index · host is `b`, no offset applied (test-plan #E13)
- [ ] 1.14 Target resolver decision table — `over.id` ∈ {`<cardId>`, `<colKey>`, `col-root:<k>`, `rail:<k>`} · resolve target · each returns `{colKey:<k>, kind}`; `kind==='rail'` forces slot to last (test-plan #E14)
- [ ] 1.15 Rail id never reaches persistence — `over.id === "rail:next-phase"` · run the commit path · persisted key is `next-phase`; no `changeOrder` key or assignment contains `rail:`/`col-root:` (test-plan #X7)
- [ ] 1.16 Early bail-out is effective — repeated resolutions with the pointer inside one gap · 100 calls · zero state updates while the resolved slot is unchanged (test-plan #P2)
- [ ] 1.17 Run the suite; confirm 1.1–1.16 fail for the stated reason, not a harness error. `npm test 2>&1 | tee /tmp/pi-test.log`

## 2. Pure resolver — make the L1 tests pass

- [ ] 2.1 Add `resolveDropSlot({ cardRects, pointerY, movedName, columnNames })` to `packages/client/src/lib/openspec/openspec-board-order.ts` per design D2 — count of non-moved cards whose rect midpoint is above the pointer; exact midpoint ⇒ *after*.
- [ ] 2.2 Add the shared target resolver returning `{ colKey, kind }` for `card` | `body` | `root` | `rail` ids (design D4/D5).
- [ ] 2.3 Add the without-moved → rendered index translation used to pick the marker host (design D6).
- [ ] 2.4 Leave `computeReorder` unchanged; 1.11 proves no caller adjustment is needed.

## 3. Rewire DndContext to resolve during the drag

- [ ] 3.1 Add a **headless probe component rendered inside `<DndContext>`** (design D5c, option (c)) calling `useDndContext()` for the rect map and `useDndMonitor()` for `onDragMove`, resolving the slot and lifting `{colKey, index} | null` via callback. Resolution must **not** live in the parent's handlers — measured: the parent sees 0 rects. Bail out early when the slot is unchanged, before `setState`.
- [ ] 3.2 In the probe, derive `pointerY = activatorEvent.clientY + delta.y` (design D5c, 0px error measured) and read rects via the **adjusted getters** (`rect.top`/`rect.bottom`), never the raw `rect.rect` snapshot. Do **not** add a `measuring` prop.
- [ ] 3.3 Replace `collisionDetection={closestCenter}` with **`pointerWithin` and no fallback** (design D3).
- [ ] 3.4 Reduce `handleDragEnd`'s card branch to committing the resolved slot; delete the `+1` and remove `groupChanged` from the *index* computation (keep it for the assignment). Gate the commit on the end event's **live `over`** being non-null and agreeing with `dropSlot` (design D3 frame-race guard).
- [ ] 3.5 Wire **`onDragCancel`** — absent today (`OpenSpecBoardView.tsx:438`) — clearing **both** `activeDrag` and `dropSlot`.
- [ ] 3.6 Add a separate window **`blur`** handler clearing the same state; dnd-kit binds only `pointercancel`, `resize`, and `visibilitychange` (design D5a).

## 4. Make the whole column a drop target

- [ ] 4.1 Keep `useDroppable` on `board-column-body` (design D5 — auto-scroll walks the **over node's ancestors**, `core.cjs:2953`) and register a second droppable `col-root:<colKey>` on the column root via an explicit merged ref alongside `sortable.setNodeRef` (`:624`).
- [ ] 4.2 Route **both** `handleDragEnd` branches through the 2.2 resolver. Without it `targetKey = String(over.id)` (`:317`) persists a bogus group assignment and a `changeOrder` entry under a non-existent key.
- [ ] 4.3 Fix the **column-drag regressions** the global collision change introduces (design D5b): a column released in the gutter yields `over = null` and loses the reorder; a column released over a *card* yields `over = <card>` → `indexOf` → `-1` → no-op.
- [ ] 4.4 Render the append rail inside the body as the last flex child, `position: sticky; bottom: 0`, ≥44px, drag-only, id `rail:<colKey>`, including in **empty** columns.
- [ ] 4.5 Drive the rail's active state from **the resolved slot being last**, not from the pointer being over the rail; when `over` is the rail itself, force the slot to last and suppress the in-gap marker (design D6).
- [ ] 4.6 Decide and apply the Ungrouped-column rail label — a drop there *clears* the group assignment.

## 5. Drag-time feedback and test hooks

- [ ] 5.1 Ship the test hooks the manifest asserts against (test-plan clarification C1) — `data-drop-target` on the target column, `data-drop-slot="<index>"` on the body, `data-rail-active` on the rail. These are production DOM attributes, not test-only shims.
- [ ] 5.2 Paint the insertion marker into the **existing `gap-2` space** via a pseudo-element on the card following the resolved slot — never an inserted flex child (design D6). Distinct pseudo-element and z-index band so it does not collide with `relative isolate` / `.card-stripes-fx`. Slot 0 paints into the body's `p-2` top padding.
- [ ] 5.3 Neutralise the sorting strategy with an explicit **no-op strategy (`() => null`)** — `strategy={undefined}` falls back to `rectSortingStrategy` (`sortable.cjs:303`) and still displaces (design D6).
- [ ] 5.4 Outline the target column and recede non-target columns while dragging; keep the outline as the positive signal.
- [ ] 5.5 Present edge-glow zones over dnd-kit's built-in auto-scroll (visual only — the zones cannot drive scrolling).
- [ ] 5.6 Add styles to `packages/client/src/index.css` using theme tokens, no raw hex.

## 6. L3 tests

Harness exemplars: **drag scenarios → see `tests/e2e/folder-membership-drag.spec.ts`**; **contrast → see `tests/e2e/severity-contrast.spec.ts`**; **frame timing → see `tests/e2e/chat-render-perf.spec.ts`**. Read the harness port from `.pi-test-harness.json` (`dashboardPort`) — never hardcode `:18000`.

- [ ] 6.1 Cross-column move persists — `add-auth` in `Backlog` · drag into `In flight`, release · assignment converges to `In flight`, survives reload (test-plan #F1)
- [ ] 6.2 Intra-column reorder persists — column `[add-auth, fix-bug]` · drag `add-auth` below `fix-bug`'s midpoint · order `[fix-bug, add-auth]`, survives reload (test-plan #F2)
- [ ] 6.3 Last position in an overflowing column — column with ≥14 cards, card from another column · drag below the last card's midpoint · dragged card is last, prior order unchanged ahead of it (test-plan #F3)
- [ ] 6.4 Rail reachable without scrolling — overflowing column scrolled to top, drag active · read rail box · inside the body's visible bounds, still visible after scrolling to bottom (test-plan #F4)
- [ ] 6.5 Rail drop preserves order — target `[a,b,c]`, dragging `X` from another column · release on rail · `[a,b,c,X]`; persisted order still contains `a,b,c`, not a single entry (test-plan #F5)
- [ ] 6.6 Rail in an empty column — 0-card column, drag active · release on rail · card becomes the only card; `data-rail-active` was set (test-plan #F6)
- [ ] 6.7 Marker tracks the slot — column `[a,b,c]`, drag active · move pointer across `b`'s midpoint · `data-drop-slot` goes `1` → `2`; marker moves gap (test-plan #F7)
- [ ] 6.8 Final slot indicated without hovering the rail — column `[a,b,c]` · hold below `c`'s midpoint, not over the rail · `data-rail-active="true"` and `data-drop-slot="3"` (test-plan #F8)
- [ ] 6.9 Continuous indication invariant — drag active · sweep the pointer down the full column height · `data-drop-slot` present and non-empty at every sample over the column (test-plan #F9)
- [ ] 6.10 Column header accepts a drop — drag active · release over the target column's header · card moves; `data-drop-target` was set (test-plan #F10)
- [ ] 6.11 Whole-column drop target — drag active · hover header, body, outer padding in turn · `data-drop-target` set in all three (test-plan #F11)
- [ ] 6.12 Non-target columns recede — drag active, pointer over column A · read attributes · A has `data-drop-target="true"`, all others absent (test-plan #F12)
- [ ] 6.13 Affordances are drag-only — board at rest · query rails · zero rail elements until a drag starts (test-plan #F13)
- [ ] 6.14 Grab cursor — pointer over a card · read computed cursor · `grab` at rest, `grabbing` while pressed (test-plan #F14)
- [ ] 6.15 Drag preview follows the pointer — drag active · move pointer 200px · preview tracks within tolerance (test-plan #F15)
- [ ] 6.16 Auto-scroll at the edge — overflowing column scrolled to top · hold the pointer near the body's bottom edge · `scrollTop` increases and converges toward max; edge-zone size deliberately untested (test-plan #F16)
- [ ] 6.17 Column reorder over a header — `[Backlog, In flight, Done]` · drag `Done` onto `Backlog`'s header · columns reorder, order persists (test-plan #F17)
- [ ] 6.18 Column reorder over a card — same · release over one of `Backlog`'s cards · columns reorder, not a silent no-op (test-plan #F18)
- [ ] 6.19 Tablet wrap unaffected — viewport 900px · load and start a drag · columns wrap, drop resolves, no console error (test-plan #F19)
- [ ] 6.20 Phone stack unaffected — viewport 540px · load and start a drag · columns stack, rail ≥44px, drop resolves (test-plan #F20)
- [ ] 6.21 Rail height on phone — viewport 375px, drag active · measure rail box · `height >= 44` (test-plan #E15)
- [ ] 6.22 Release outside cancels — pointer released outside every column · release over the page margin · no assignment/order change; slot cleared; no rail, marker, or preview (test-plan #X1)
- [ ] 6.23 Release in the gutter cancels — pointer released between two columns · release · card does not move into either neighbour (test-plan #X2)
- [ ] 6.24 Interrupted by pointer-cancel — `pointercancel` mid-drag · fire it · no order change; rail, marker, preview, receded state cleared (test-plan #X3)
- [ ] 6.25 Interrupted by tab-hide — `visibilitychange` to hidden mid-drag · fire it · same cleared state as 6.24 (test-plan #X4)
- [ ] 6.26 Interrupted by window blur — window `blur` mid-drag, tab still visible · fire it · same cleared state; exercises the separate handler since dnd-kit has no blur listener (test-plan #X5)
- [ ] 6.27 Stale-slot frame race — pointer moves from inside a column into the gutter and releases within one frame · perform it · commits nothing (test-plan #X6)
- [ ] 6.28 Drag-move frame budget — 64-card `next-phase` column · sweep a drag top→bottom for ≥3s · no frame exceeds 16.7ms (test-plan #P1)
- [ ] 6.29 Marker contrast across themes — 9 themes × {light, dark} · render marker over the column background · ratio ≥ 3:1, WCAG 2.1 SC 1.4.11 (test-plan #A1)
- [ ] 6.30 Rail contrast across themes — same 18 combinations · render rail active · ratio ≥ 3:1 (test-plan #A2)
- [ ] 6.31 Static-accent risk themes — github, tokyo-night, rose-pine, solarized (light + dark) · render marker and rail · ratio ≥ 3:1; highest risk because `--accent-primary` is static (test-plan #A3)

## 7. Manual verification

- [ ] 7.1 Ungrouped rail wording reads correctly — a drop there *clears* the group assignment, so the label must not read as "add to a group" (test-plan: manual-only)

## 8. Verify and land

- [ ] 8.1 Run E2E against the docker harness per the `run-dashboard-e2e-local-changes` skill so it reflects local code, not a cached image.
- [ ] 8.2 Manually reconfirm the original report: drag a card to the last position of a deep column, across columns and within the column.
- [ ] 8.3 `npm test` green; `npm run quality:changed` clean.
- [ ] 8.4 Re-verify every `file:line` citation in `proposal.md` and `design.md` against the tree — several drifted during planning.
- [ ] 8.5 Run the `review-code` discipline over the diff.
- [ ] 8.6 Update `OpenSpecBoardView.tsx.AGENTS.md` and `openspec-board-order.ts.AGENTS.md` purpose rows with `See change: fix-openspec-board-drop-targeting`.
- [ ] 8.7 `npm run build && curl -X POST http://localhost:8000/api/restart` (client change ⇒ build + restart).
