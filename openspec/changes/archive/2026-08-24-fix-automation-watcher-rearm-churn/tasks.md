# Tasks

Implementation landed ahead of this proposal during a server memory-leak
investigation; the proposal was written retroactively to cover it. Boxes are
checked against code already in the working tree.

## 1. Watcher reconciliation

- [x] 1.1 Add `attachedBases(): string[]` to the `AutomationWatcher` interface and implementation (`packages/automation-plugin/src/server/automation-watcher.ts`).
- [x] 1.2 Add exported `reconcileWatchers(watcher, wantBases)`: detach not-wanted, attach newly-wanted, no-op in steady state.
- [x] 1.3 Replace `detachAll()` + re-attach-all in `attachWatchers()` with `reconcileWatchers()` (`packages/automation-plugin/src/server/index.ts`).
- [x] 1.4 Extract the rescan debounce to `RESCAN_DEBOUNCE_MS = 15_000` (was an inline `2000`), with the rationale in a doc comment.

## 2. Tests

- [x] 2.1 `attachedBases()` reflects attach/detach (fs integration test).
- [x] 2.2 `reconcileWatchers` attaches new bases and detaches removed ones (fake watcher, no fs).
- [x] 2.3 **Regression guard**: repeated `reconcileWatchers` with an unchanged set performs zero additional detaches.
- [x] 2.4 Full `packages/automation-plugin` suite green (208 tests).

## 3. Verification

- [x] 3.1 Measure re-arm rate against the running server before/after — 54 → 8 per 120 s (7× reduction).
- [x] 3.2 Confirm no automation arms late in practice after the 2 s → 15 s debounce change (manual: add a folder with an automation, observe it arms within 15 s).

## 4. Docs

- [x] 4.1 Update the `automation-watcher.ts` row in `packages/automation-plugin/src/server/AGENTS.md` (purpose + `See change: fix-automation-watcher-rearm-churn`).
- [x] 4.2 Update the `index.ts` row in the same tree file if its summary mentions the 2 s rescan.
