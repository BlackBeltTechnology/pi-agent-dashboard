# Test Plan — fix-kb-card-refresh-and-shared-stats

Stage: design   Generated: 2026-02-10

No clarifications needed — every Triple slot resolves from the delta specs / design (POLL_MS=1000, MAX_POLL_MISSES=3, REINDEX_GUARD_MS=4000, exact labels and testids).

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | folder-section: sibling control states | decision-table | L1 | automated | card-placement section with stats forcing each of error / indexing / not-indexed / stale / populated | render | `folder-kb-card-reindex` accessible name is Retry / (disabled, in-progress) / Index now / Reindex now / Reindex now respectively; label perceivable (wrapper `title`) while disabled |
| E2 | dcl: sibling stays outside pill root; sidebar has none | DOM-structure | L1 | automated | same section rendered with `placement="card"` and with default sidebar placement | render | card: exactly one `folder-kb-card-reindex` as sibling of the pill, zero interactive elements inside the pill's `role="button"` root; sidebar: zero `folder-kb-card-reindex` |
| E3 | stats: distinct folders independent | state-partition | L1 | automated | two stores subscribed for cwd A and cwd B, both settled | `reindex()` on A | B's snapshot unchanged: `pending=false`, no fetch issued for B, counts untouched |
| E4 | stats: guard at zero subscribers | BVA (lifecycle boundary) | L1 | automated | `reindex()` fired, then last consumer unsubscribes before any poll observes `indexing:true` | fake-timer advance past REINDEX_GUARD_MS=4000 | `pending` cleared in retained snapshot; NO fetch issued at zero subscribers; a consumer remounting after sees `pending=false` and control enabled |
| E5 | stats: revalidate-on-subscribe coalesced | equivalence (in-flight vs settled) | L1 | automated | store with settled snapshot; second case: store with fetch in flight | new consumer subscribes | settled case: snapshot served synchronously + exactly one background fetch; in-flight case: snapshot served + ZERO additional fetch (coalesced) |
| E6 | stats: one poll loop per folder | count-assertion | L1 | automated | two consumers subscribed to same cwd, stats report `indexing:true` | advance fake timers 3000ms | exactly 3 stats fetches issued (1/s), not 6 |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | stats: reindex in one surface updates another | state-convergence | L1 | automated | two hook consumers (panel-shaped + section-shaped) on one cwd, mocked fetch sequence idle→indexing→settled(new counts) | `reindex()` from consumer A | consumer B converges pending→indexing→settled new counts without remount; both snapshots referentially identical |
| F2 | stats: dialog reindex reflected in sidebar row (the reported defect) | state-convergence | L3 | automated | harness `/fixtures/kb-sample` pinned, KB settings overlay open, sidebar KB row visible (see tests/e2e/kb-folder-slot.spec.ts) | click `kb-reindex-now` in settings panel | sidebar `folder-kb-section` `data-state` leaves its pre-reindex value and reaches `populated` with updated `folder-kb-count` WITHOUT page reload |
| F3 | folder-section: sibling activation never opens settings | state-transition (illegal edge) | L1 | automated | card-placement section, settled stats | pointer click AND keyboard Enter/Space on `folder-kb-card-reindex` | reindex POST issued; wouter navigation NOT called (no `/folder/:cwd/kb` route change) |
| F4 | stats+section: busy shared across consumers | state-convergence | L1 | automated | two consumers on one cwd | `reindex()` from A while B renders | B's control/menu-item disabled for the whole pending+indexing window; activating B invokes no second POST |
| F5 | stats: poll ticks never toggle loading | invariant-assertion | L1 | automated | store polling during `indexing:true` | each 1s poll tick | `loading` stays false across ticks (only initial/revalidate/refetch epochs set it) |
| F6 | dcl: sibling button visual fit on the worktree card | visual/subjective | — | manual-only | worktree session card with KB section in each theme | human looks | [judgment: control reads compact, aligned with flat pill, not crowding the subcard row] |
| F7 | stats: remount shows settled snapshot | state-transition | L1 | automated | reindex settles while only consumer A mounted; A unmounts; B mounts later | B's mount | B renders settled post-reindex counts immediately (no stale pre-reindex flash), then background revalidate fires |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | stats: shared error channels | fault-injection (abort) | L1 | automated | reindex POST rejects (500) | `reindex()` from panel consumer | BOTH consumers show error state (`reindexError` set, section `data-state="error"`); subsequent `reindex()` from the other consumer clears it |
| X2 | stats: epoch ordering | fault-injection (delay) | L1 | automated | older fetch epoch resolves AFTER a newer epoch (delayed promise) | both resolve out of order | store snapshot reflects the newer epoch; the stale response is discarded |
| X3 | stats: miss tolerance preserved under shared store | fault-injection (transient) | L1 | automated | 2 consecutive poll failures then success, observed by two consumers | polls fire | no error surfaced to either consumer, spinner retained; 3rd consecutive failure surfaces `error` to both and stops the poll |
| X4 | stats: churn does not abort in-flight fetch | fault-injection (lifecycle) | L1 | automated | subscribe → unsubscribe → resubscribe within one tick while first fetch in flight (StrictMode shape) | fetch resolves | result lands in the snapshot; no AbortError surfaced; no duplicate fetch issued |

---

## Coverage summary

- Requirements covered: 11/11 delta requirements/scenarios (stats ADDED ×7 scenarios, folder-section MODIFIED ×4 new scenarios, dcl carve-out ×1)
- Scenarios by class: edge 6 · perf 0 · frontend 7 · error 4
- Scenarios by level: L1 15 · L2 0 · L3 1
- Scenarios by disposition: automated 16 · manual-only 1

## New infra needed

none — L1 rows extend `packages/kb-plugin/src/client/__tests__/` (exemplars: `useKbStats.test.tsx`, `FolderKbSection.test.tsx`); the L3 row extends `tests/e2e/kb-folder-slot.spec.ts` (fixture + `reindexFromMenu`/row-scoping helpers already exist). Note: that spec's existing "reloads → sidebar worktree row populated" assertion remains valid post-change (reload still works); F2 adds the no-reload path.
