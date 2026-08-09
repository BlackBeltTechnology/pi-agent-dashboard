# Tasks — harden-display-fit-perf-gate

All work is test-only. No production module is edited.

## 1. Derive and land the budget

- [x] 1.1 Replace `MAX_LAG_MS = 50` with `200` in `packages/server/src/attachments/__tests__/display-fit-perf.test.ts`, and carry the derivation table (healthy 1.1–11.9 ms · worst contention 62.9 ms · smallest regression 349 ms) plus the re-derivation rule in the constant's comment, so the next reader re-derives instead of nudging. See design.md D1.
- [x] 1.2 Update the constant's `test-plan #P1/#P2 budget` comment so it still names the scenarios it gates after P2 is un-skipped.

## 2. Correct the stale measurement record

- [x] 2.1 Rewrite the `it.skip` P2 comment block in `display-fit-perf.test.ts`: remove the disproven `in-process … max lag 0 ms` table and the throughput recommendation, and point at design.md D5 for the corrigendum. See design.md D5.
- [x] 2.2 Leave `openspec/changes/archive/2026-08-05-fit-attachments-for-display/design.md` unmodified (archive is an immutable historical record); confirm the corrigendum lives only in this change's design.md D5 and the test comment.

## 3. Tests (folded from test-plan.md)

Exemplar for every row below: the existing P1/P3/P4 in `packages/server/src/attachments/__tests__/display-fit-perf.test.ts` — copy its `photoLikePng` fixture builder, pool warm-up, and `startLagMonitor(10)` harness glue.

- [x] 3.1 P1 — one 2400×1600 photo-like PNG through `createFitWorkerPool({ size: 2 })` with the pool warmed (input) · run the fit and sample the loop (trigger) · `startLagMonitor(10).stop()` max lag < 200 ms, healthy measured 1.1–1.6 ms (observable). Update the existing P1 to the production pool size and the new budget (test-plan #P1)
- [x] 3.2 P2 — burst of 5 × 1600×1200 photo-like PNGs via `Promise.all` through `createFitWorkerPool({ size: 2 })`, pool warmed (input) · all fits run concurrently (trigger) · max lag < 200 ms, healthy measured 1.1–11.9 ms (observable). Un-skip P2 and re-target it to this worker-path budget assertion, dropping its in-process baseline (test-plan #P2)
- [x] 3.3 P3 — the single-image workload under full-suite fork saturation (input) · a complete `npm test` run at `maxWorkers:"50%"` across 383 server files (trigger) · P1 and P2 stay green, i.e. max lag stays < 200 ms against the 62.9 ms worst observed contention (observable) (test-plan #P3)
- [x] 3.4 E1 — the worst observed contention figure 62.9 ms (input) · read the budget constant from the test module (trigger) · budget > 62.9 ms, strictly above the contention floor the old 50 ms sat below (observable) (test-plan #E1)
- [x] 3.5 E2 — the smallest measured regression signal 349 ms (input) · read the budget constant from the test module (trigger) · budget < 349 ms, keeping the derivation window non-empty (observable) (test-plan #E2)
- [x] 3.6 X1 — offload disabled via `createFitWorkerPool({ useWorker: false, size: 2 })`, modelling `workersDisabled = true` after a spawn failure (input) · the same single-image workload with the pool warmed (trigger) · max lag > 200 ms, measured 349–416 ms, proving P1 is not vacuous (observable) (test-plan #X1)
- [x] 3.7 X2 — the forced-fallback pool constructed at `size: 2` matching `server.ts:717` rather than the `fit-worker-pool.ts` default of 1 (input) · X1 executes (trigger) · the fallback pool's configured size equals the production size, and a default-size baseline is not used as the regression anchor (observable). See design.md D4 (test-plan #X2)

## 4. Validate

- [x] 4.1 Run the perf file in isolation on an idle machine, 3 consecutive times, and confirm every row is green with the recorded margins.
- [x] 4.2 Run the full `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` and confirm P1/P2 stay green under saturation — the exact condition that produced the original 62.9 ms failure.
- [x] 4.3 Confirm anti-vacuity end to end: with X1's forced fallback in place, the P1 assertion fails; restore and it passes.
- [x] 4.4 Confirm no production module and no vitest config file appears in `git diff --name-only`.
