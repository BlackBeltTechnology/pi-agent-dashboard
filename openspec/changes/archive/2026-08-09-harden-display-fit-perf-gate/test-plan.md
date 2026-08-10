# Test Plan — harden-display-fit-perf-gate

Stage: design   Generated: 2026-08-07

All Triple slots resolved from measured anchors in `design.md` D1/D3/D4 — no
clarification gate raised. Every threshold below traces to a recorded number,
not a guess.

---

## Scenarios

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | Fitting SHALL NOT block the server → "A large paste does not stall the event loop" | threshold (derived budget) | L1 | automated | one 2400×1600 photo-like PNG through `createFitWorkerPool({ size: 2 })`, pool warmed | `startLagMonitor(10).stop()` max lag **< 200 ms** (healthy measured 1.1–1.6 ms) | monitor start → fit resolve |
| P2 | Fitting SHALL NOT block the server → "Concurrent pastes queue without stalling" | threshold (derived budget) | L1 | automated | burst of 5 × 1600×1200 photo-like PNGs via `Promise.all` through `createFitWorkerPool({ size: 2 })`, pool warmed | max lag **< 200 ms** (healthy measured 1.1–11.9 ms) | monitor start → all fits resolve |
| P3 | Budget SHALL sit above saturated-run contention | threshold (regression-side margin) | L1 | automated | same single-image workload, pool warmed | full `npm test` run completes with P1/P2 green — i.e. max lag stays < 200 ms under `maxWorkers:"50%"` fork saturation (worst observed contention 62.9 ms) | one full-suite run |

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Budget SHALL be derived, not arbitrary | BVA (lower bound) | L1 | automated | worst observed contention 62.9 ms | budget constant read from the test module | budget > 62.9 ms — i.e. strictly above the contention floor the old 50 ms sat below |
| E2 | Budget SHALL be derived, not arbitrary | BVA (upper bound) | L1 | automated | smallest measured regression signal 349 ms | budget constant read from the test module | budget < 349 ms — i.e. strictly below the smallest signal it must catch, keeping the window non-empty |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | "The gate fails when the offload regresses" | fault-injection (forced fallback) | L1 | automated | offload disabled: `createFitWorkerPool({ useWorker: false, size: 2 })` — models `workersDisabled = true` after a spawn failure at the production pool size | same single-image workload, pool warmed | max lag **> 200 ms** (measured 349–416 ms) — proving the P1 assertion is not vacuous |
| X2 | "The gate fails when the offload regresses" | fault-injection (pool-size fidelity) | L1 | automated | the forced-fallback pool is constructed at `size: 2`, matching `server.ts:717`, NOT the `fit-worker-pool.ts` default of 1 | X1 executes | the fallback pool's configured size equals the production size — a default-size (1) baseline SHALL NOT be used as the regression anchor |

---

## Coverage summary

- Requirements covered: 3/3 (all scenarios of the modified `attachment-storage`
  requirement, including the added anti-vacuity scenario)
- Scenarios by class: edge 2 · perf 3 · frontend 0 · error 2
- Scenarios by level: L1 7 · L2 0 · L3 0
- Scenarios by disposition: automated 7 · manual-only 0

## New infra needed

None. All seven rows live in the existing
`packages/server/src/attachments/__tests__/display-fit-perf.test.ts` alongside
the current P1/P3/P4, using the existing `startLagMonitor` and
`createFitWorkerPool` helpers. No new vitest project, config, or harness.

## Notes on rows deliberately NOT written

- **No throughput scenario.** Measured, the worker path is *slower* in wall time
  for a single image (449–459 ms vs 359–426 ms); parallelism only pays across a
  burst while transfer cost is paid always. The skipped-P2 comment's throughput
  recommendation is void (design.md D5).
- **No comparative-ratio scenario.** Rejected on arithmetic in design.md D2 —
  the monitor returns a max, so contention is additive and does not cancel.
- **No separate multi-session liveness scenario.** "Other sessions' events SHALL
  continue to be processed" is precisely what event-loop availability measures;
  P1/P2 already assert it (design.md D6).
