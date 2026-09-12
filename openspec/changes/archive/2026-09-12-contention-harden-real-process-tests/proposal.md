## Why

The 2026-09-01 full-suite runs on a loaded developer box (16 cores, ambient load
~4–10) produced a **different single rotating failure per run** across 8 runs,
while CI stayed green:

| run | failing test | class |
|---|---|---|
| baseline 1 | `server/auth-redirect-base` P1 — 100k builds < 100ms budget | wall-clock perf budget |
| baseline 2, gate 1 | `server/rpc-keeper` E5 — post-rotation one-shot read | one-shot read race (FIXED by `make-test-suite-deterministic`) |
| final gate 1 | `server/cli-signal-forwarding` — SIGTERM→exitIntent recording | real-process signal timing |
| final gate 2 | `client/FileLink.split` — waitFor 5s budget exhausted | event-loop starvation at extreme load |

`make-test-suite-deterministic` eliminated the client fixed-tick-barrier class
and machine-enforced it. The remaining population is **real-process,
wall-clock-budgeted tests** (server signal handling, log rotation, perf
budgets) plus isolated client waitFor-budget starvations. Each fires at ~1 per
loaded run, which keeps `npm test` untrustworthy on exactly the machines the
suite runs on most. The P2 3-consecutive-run gate of
`make-test-suite-deterministic` was marked environment-limited because this
population blocks it; that gate becomes satisfiable only when this change
lands.

## What Changes

- **Census the class, then fix member by member with a poll-or-budget rule:**
  every real-process test that asserts on wall-clock outcomes either (a) polls
  a bounded observable condition (the `waitFor` pattern
  `make-test-suite-deterministic` applied to keeper E5) or (b) carries an
  explicitly-justified, load-scaled budget. One-shot reads of process outcomes
  are the defect; wall-clock budgets need headroom proportional to fork count.
- **Known first members:** `cli-signal-forwarding` (SIGTERM propagation window),
  `auth-redirect-base` P1 (100ms perf budget under 8 forks), `FileLink.split`
  (waitFor starvation under saturation — investigate whether the 5s
  `asyncUtilTimeout` needs a load-aware floor or the test's resolve chain can
  be made deterministic).
- **A repeatable verification gate:** the 3-consecutive-run soak from
  `parallel-test-execution` becomes passable on a loaded machine once the class
  is clean; re-run it as this change's P2.

## Capabilities

### New Capabilities

None — this is hardening of existing test behaviour; the specs already require
contention tolerance (`parallel-test-execution`).

### Modified Capabilities

- `parallel-test-execution`: the "Timeouts and async waits tolerate fork
  contention" requirement is extended from client `waitFor` discipline to the
  server real-process tests' read/budget discipline.

## Impact

- `packages/server/src/__tests__/cli-signal-forwarding.test.ts` — bounded signal
  propagation window
- `packages/server/src/__tests__/auth-redirect-base.test.ts` — budget headroom
  or fork-scaled threshold
- `packages/client/src/components/tool-renderers/__tests__/FileLink.split.test.tsx`
  — resolve-chain determinism or budget floor
- Census sweep over `packages/server/src/**/__tests__` and
  `packages/*/src/**/__tests__` for further one-shot process-outcome reads

## Discipline Skills

- `systematic-debugging` — each member is a flake with a live reproduction
  under load; root-cause before editing.
- `performance-optimization` — the perf-budget member is a measured-threshold
  change; measure the isolated baseline before raising anything.

None of `security-hardening`, `observability-instrumentation`,
`doubt-driven-review`, or `review-code` are triggered beyond the repo defaults.
