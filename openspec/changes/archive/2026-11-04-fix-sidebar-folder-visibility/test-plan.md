# Test Plan — fix-sidebar-folder-visibility

Stage: apply   Generated: 2026-11-03   Owner decisions applied (2026-11-03): Q1(a) hidden alive sessions do not count as alive (E22); Q2(a) archive search counts as Session search, selected-session clause off (E14, E23).

Level exemplars (all exist):
- L1 visibility / paging: `packages/client/src/components/__tests__/SessionList.folder-menu.test.tsx` (stub groups, `folder-ended-toggle-<cwd>`), `SessionList.test.tsx` (F1/F2 paging), `SessionList.header-declutter.test.tsx` (Folders/Session query).
- L1 drag: `packages/client/src/components/__tests__/SessionList.folder-membership-drag.test.tsx` (mocks `DndContext`, drives `handlers.onDragStart/End/Cancel`, `describe("empty-tier eject zone")`).
- L3: `tests/e2e/sessions-page-stub-group.spec.ts` (seeded unpinned `/fixtures/stub-dir`), `tests/e2e/folder-membership-drag.spec.ts` (`mouse.move` drag helper, "renders an empty-tier eject zone…" L299), `tests/e2e/registry-shed-sidebar-convergence.spec.ts`. Helpers: `tests/e2e/helpers/index.js` (`setSearch`, `pinDirectory`, `gotoDashboard`).

---

## Scenarios

### Edge-case

Unpinned-folder predicate decision table. Fixed: folder is non-workspace, unpinned. Columns: alive · selected-in-folder · Folders q · tag filter · Session q · archive match · endedTotals>0 → visible.

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | session-search: ended-only hidden even unarchived (#1086 repro) | decision-table (row: no·no·none·none·none·no·yes) | L1 | automated | unpinned `/old/dir` holding 2 ended sessions, `endedTotalsMap {"/old/dir":2}`, nothing selected, no filters | render `SessionList` | `queryByTestId("folder-ended-toggle-/old/dir")` and the folder header are absent |
| E2 | session-listing: stub-only unpinned hidden | EP (stub: 0 held sessions) | L1 | automated | `endedTotalsMap {"/old/dir":3}`, no session for `/old/dir`, unpinned, not in workspace | render, no filter | no group for `/old/dir`; no `sessions_page` sent |
| E3 | session-listing: Folders filter reveals stub, expander pages | decision-table (·Folders q matches) | L1 | automated | as E2 | type Folders query `old/dir`, click `folder-ended-toggle-/old/dir` | stub group appears; `onSessionsPage` called once with `{cwd:"/old/dir", offset:0}` |
| E4 | session-search: Folders q matches regardless of status; filter alone decides | decision-table (Folders q non-matching) | L1 | automated | ended-only unpinned `/old/dir` that holds the selected session | Folders query `zzz` (no match) | folder absent (selected-session clause is off under a Folders query) |
| E5 | session-search: alive (non-hidden) session visible | decision-table (alive=yes) | L1 | automated | unpinned folder, one `running`/`idle` session | render | folder visible |
| E6 | session-search: last alive ending hides folder | state-transition | L1 | automated | unpinned folder, one alive session, none selected | rerender with that session `status:"ended"` and `endedTotalsMap` +1 | folder leaves the DOM |
| E7 | session-listing/search: pinned folder keeps ended expander | EP (pinned) | L1 | automated | `pinnedDirectories:["/p"]`, only ended sessions, `endedTotalsMap {"/p":3}` | render, no filter | `folder-ended-toggle-/p` present, label from endedTotals |
| E8 | same: workspace folder keeps expander | EP (workspace-claimed) | L1 | automated | `/w` in workspace `ws1.folders`, unpinned, only ended sessions / stub-only | render, no filter | `folder-ended-toggle-/w` present; expanding sends `sessions_page {cwd:"/w",offset:0}` |
| E9 | session-search: tag filter reveals via matching session, never a stub | decision-table (tag=yes, matching ended session vs stub-only) | L1 | automated | `/a` ended-only with one session tagged `x`; `/b` stub-only (`endedTotalsMap /b:3`, no session) | active tag filter `x` | `/a` visible; `/b` absent |
| E10 | same: tag filter matches nothing | decision-table (tag=yes, no match) | L1 | automated | ended-only `/a` with sessions tagged `y`, tag filter `x` | render | `/a` absent |
| E11 | session-search: archive-search match keeps ended-only folder | decision-table (archive match=yes) | L1 | automated | ended-only unpinned `/a` with archive-search matches for the query | archive search active | `/a` visible with `Archive matches` section |
| E12 | D3 selected-session clause | decision-table (selected=yes) | L1 | automated | ended-only unpinned `/a`, `selectedId` = one of its ended sessions, no filters | render | `/a` visible, selected card rendered |
| E13 | D3 selection moves / clears | state-transition | L1 | automated | E12 state | (a) `selectedId` → session in `/b` (alive); (b) `selectedId` → null | `/a` absent after (a); and after (b) |
| E14 | D3 off during Session search (archive search counts as Session search, Q2a) | decision-table (Session q=yes) | L1 | automated | E12 state, no alive sessions in `/a` | type `Session…` query | `/a` absent |
| E15 | D3 hidden selected session | EP (hidden) | L1 | automated | `/a` sole session `hidden:true`, selected, show-hidden off | render | `/a` absent |
| E16 | D3 selected + tag filter that excludes it | decision-table (tag=yes, no match, selected=yes) | L1 | automated | E12 state, tag filter matching none of `/a`'s sessions | render | `/a` absent (filter alone decides) |
| E17 | session-search: sidebar with no visible folder shows empty message | EP (all hidden) | L1 | automated | no pins, no workspaces, two unpinned ended-only folders, endedTotals>0 | render | "No active sessions" shown; no folder list |
| E18 | design D1: gate keeps pinned/workspace conjuncts | decision-table (pinned≥1 / workspaces≥1 × unpinned all hidden) | L1 | automated | (a) one pinned folder + hidden unpinned folder; (b) one workspace + hidden unpinned folder | render | "No active sessions" NOT shown; `DndContext` subtree mounted (pinned group / workspace header present) |
| E19 | session-listing: group key = worktree main path | EP (worktree grouping) | L1 | automated | ended-only session with cwd `/repoA/.worktrees/wt1`, group key `/repoA` unpinned, `endedTotalsMap {"/repoA":1}` | render | `/repoA` group absent; pinning `/repoA` makes its expander appear |
| E20 | design Non-Goals: hidden-only ended sessions | decision-table (hidden ended × pinned/unpinned) | L1 | automated | folder with only `hidden` ended sessions, show-hidden off, `endedTotals>0` | render as (a) unpinned, (b) pinned | (a) absent; (b) stub expander still present (unchanged characterization) |
| E21 | sidebar-drag-reorder: eject zone presence | decision-table (drag type × pinned count × filter) | L1 | automated | rows: `workspace-folder` × (0 pinned / ≥1 pinned / ≥1 pinned all hidden by Folders filter) → present; `session`, `workspace`, `pinned-group` × ≥1 pinned → absent | `handlers.onDragStart` with that `active.data.current.type` | `pinned-tier-drop-zone` present exactly in the three `workspace-folder` rows |
| E22 | session-search: hidden alive session does not count (owner-accepted Q1a) | EP (hidden alive) | L1 | automated | unpinned `/a` whose only non-ended session is `hidden:true`, show-hidden off, no filters, not selected | render `SessionList` | `/a` absent (alive clause reads post-`filterSessions` sessions) |
| E23 | session-search: archive search is Session search; selected-session clause off (owner-accepted Q2a) | decision-table (archive search=yes, selected=yes, archive match no/yes) | L1 | automated | ended-only unpinned `/a` holding the selected session; archive search active (`Session…` query) with (a) no archive match in `/a`, (b) an archive match in `/a` | render `SessionList` | (a) `/a` absent; (b) `/a` visible with its `Archive matches` section (via the archive-match clause, not the selection) |

### Performance

None — client-only visibility change; no latency/throughput requirement in the spec. (The memoised `visibleUnpinned` list is covered by correctness rows; no threshold defined.)

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| F1 | eject zone absent after drag ends | state-transition (illegal edges) | L1 | automated | `workspace-folder` drag active, zone present, ≥1 pinned | `onDragEnd` (drop on zone); separately `onDragCancel`; separately real-DndContext Escape | after each, `pinned-tier-drop-zone` absent |
| F2 | design D2: idle sidebar gains no node/gap | invariant | L1 | automated | ≥1 pinned folder, no drag | render, then start+end a `session` drag | no extra empty `<li>` vs baseline `<ul>` child count; zone `<li>` exists only during workspace-folder drag |
| F3 | eject outcomes identical via zone or pinned group | decision-table (drop target) | L1 | automated | `workspace-folder` from ws `A`, pinned group present, zone present | `onDragEnd` over `pinned-tier` id; then over `pinned-group` id | each sends exactly one `onMoveFolderToWorkspace(path, null)`; no other call |
| F4 | same, in a rendered browser; layout-shift criterion | state-convergence + invariant | L3 | automated | seeded workspace with a folder + ≥1 pinned folder + a pinned folder below the zone | pointer-drag workspace folder (helper from `folder-membership-drag.spec.ts`): (a) assert zone appears; (b) drop on zone; (c) repeat, drop on pinned group below zone | (a) `getBoundingClientRect().y` of rows above zone unchanged, zone height ≥ 64px; (b) folder ends pinned (via `workspaces_updated`), zone gone; (c) same outcome, one message |
| F5 | eject zone when a filter hides all pinned | state-convergence | L3 | automated | pinned folders exist; Folders filter matching none of them | drag a workspace folder (unfiltered workspace row still visible) | zone present while dragging; drop on it pins the folder |
| F6 | #1086 in browser: seeded unpinned stub hidden, Folders filter reveals, expander pages | state-convergence | L3 | automated | seeded unpinned `/fixtures/stub-dir` with `endedTotals>0` | `gotoDashboard`; assert hidden; `setSearch(page,"folders","stub-dir")`; expand | initially no `folder-ended-toggle-/fixtures/stub-dir`; after filter it appears and first page rows render (updates `sessions-page-stub-group.spec.ts`) |
| F7 | paging re-arm still works for a filter-revealed stub | state-convergence | L3 | automated | F6 setup | existing flows in `paging-exhausted-reconnect-rearm.spec.ts` and `paging-empty-reply-exhausted.spec.ts` after revealing via Folders filter | exhausted mark / in-flight release invariants unchanged (specs adapted, assertions same) |
| F8 | other e2e specs using `folder-ended-toggle-<cwd>` unaffected | regression sweep | L3 | automated | specs listed in the e2e sweep task (`session-state-honesty`, `archive-fold`, `session-ended-orphan-heal`, …) | run suite | each still passes (cwd alive or pinned); any failing one is fixed by pinning/alive, not by reverting the rule |

### Error-handling

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | design D4: stale mirrored drag state | fault-injection (abort: provider unmount mid-drag) | L1 | automated | `workspace-folder` drag active (zone shown) | rerender so the `<DndContext>` subtree unmounts/remounts with no `onDragCancel` (e.g. `workspaces_updated` removes the last workspace and pins) | no throw; zone absent after remount (derived from dnd-kit `active`, not mirrored `activeDragType`) |
| X2 | session-listing: lost page reply on filter-revealed stub | fault-injection (abort/timeout of `sessions_page_result`) | L1 | automated | Folders-filter-revealed stub, `sessions_page` sent, no reply, fake timers +15s | advance 15s, click expander again | in-flight mark released, a second `sessions_page` `{cwd, offset:0}` sent (adapts "X6 lost reply retried") |
| X3 | session-listing: no paging when all held, on a revealed folder | EP/boundary (`endedTotal == held`) | L1 | automated | unpinned folder revealed by Folders filter, `endedTotals` equals held ended count | expand | zero `sessions_page` (adapts existing test; pin/filter fix per the unit-test update task) |

---

## Coverage summary

- Requirements covered: 3 spec files / all new scenarios (session-search 12, session-listing 2 new + stub narrowing, sidebar-drag-reorder 3) + D1–D4 + issue repros #1086 (E1, F6) and #1085 (E21, F4)
- Scenarios by class: edge 23 · perf 0 · frontend 8 · error 3
- Scenarios by level: L1 29 · L2 0 · L3 5
- Scenarios by disposition: automated 34 · manual-only 0

## New infra needed

- L1: the drag test file mocks `DndContext` (renders children only), so a child reading `useDndContext().active` sees `null` and `handlers.onDragStart` no longer toggles the zone. E21/F1/F2/F3/X1 need either `vi.mock` of `useDndContext` driven by `handlers`, or a thin `DndContext` mock wrapping the real provider/context with an `active` value updated from `onDragStart/End/Cancel`. Small test-helper change in `SessionList.folder-membership-drag.test.tsx`; no new level. (Escape in F1 needs the real `DndContext` or is covered in L3 F4.)
- Otherwise: none.
