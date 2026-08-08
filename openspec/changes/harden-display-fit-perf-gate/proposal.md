## Why

`display-fit-perf.test.ts` P1 asserts that fitting a large image keeps event-loop
lag under 50 ms. It failed on a developer machine during a full `npm test`
(62.9 ms) but passes 3/3 on an idle box, and passes in CI.

`startLagMonitor` samples `now - last - intervalMs` on a `setInterval` tick and
returns the **maximum**, so any single delayed tick counts as lag — including
delay from other vitest forks saturating the CPU. The server project runs 383
test files under `pool: "forks"` with `maxWorkers: "50%"`. The 50 ms line sits
below the contention floor of a saturated run, so the gate reports host load, not
code health.

### The design record this change corrects first

`openspec/changes/archive/2026-08-05-fit-attachments-for-display/design.md` D4
("settled; rationale CORRECTED") states *"jimp v1's async API yields, so
in-process fitting blocks the loop for ~0 ms"* and records `in-process | ~1710 ms
| 0 ms` on a 5 × 1600×1200 burst.

**Re-measured on D4's exact workload with current code** (3 consecutive runs,
outside the runner):

| path | workload | wall | max lag |
|---|---|---|---|
| in-process | burst 5 × 1600×1200 | 1419–2170 ms | **1409–2160 ms** |
| worker (2) | burst 5 × 1600×1200 | 1164–1259 ms | 1.1–11.9 ms |
| in-process | single 2400×1600 (P1's) | 359–426 ms | **349–416 ms** |
| worker (2) | single 2400×1600 (P1's) | 449–459 ms | 1.1–1.6 ms |

The **wall times reproduce** D4's (~1710 ms in-process, ~1030 ms worker),
confirming the same workload — only the lag column is wrong. `event-loop-lag.ts`
`stop()` carries a fix whose own comment explains it: without a final sample,
*"work that blocks the loop from start() until stop() prevents every tick from
running, and the monitor reports 0"*. A continuously-blocking in-process burst is
exactly that case, so D4's `0 ms` is a pre-fix artifact that was never re-run.

**jimp v1 does not yield.** In-process fitting blocks the loop for the full
duration of the work. D4's "rationale CORRECTED" is itself wrong; its *original*
rationale — an inline resize stalls the loop — was right. Lag is therefore a
valid observable, separating healthy (1.1–11.9 ms) from regressed (349–2160 ms)
by roughly 300×. Only the **threshold** is wrong.

## What Changes

**Recalibrate the budget from an arbitrary 50 ms to a derived value, and record
the derivation** so the next person can re-derive rather than guess:

| anchor | measured | source |
|---|---|---|
| healthy worker lag | 1.1–11.9 ms | table above |
| worst observed contention | 62.9 ms | the failing full-suite run |
| smallest regression signal | 349 ms | in-process single image |

A **200 ms** budget clears the worst observed contention by ~3.2× and sits ~1.75×
below the smallest regression. 50 ms cleared contention by 0.8× — i.e. not at
all.

**Restore coverage of the concurrent-paste scenario.** P2 is currently
`it.skip`, so the spec scenario "Concurrent pastes queue without stalling" has
**no automated coverage**. With a derived absolute budget it needs no in-process
baseline at all: assert the worker-path burst stays under the same budget
(healthy 1.1–11.9 ms vs 1409–2160 ms regressed — a ~100× margin).

**Fix a fidelity trap in the regression check.** A real silent fallback
(`workersDisabled = true` after a spawn failure) runs `size` concurrent on-loop
decodes, and production uses `size: 2` (`server.ts:717`), but the pool defaults
to `size: 1` (`fit-worker-pool.ts:101`). Any verification that the gate still
fails on a fallback MUST use `useWorker: false, size: 2` to model production —
otherwise it validates against the wrong anchor.

### Designs considered and rejected

- **A comparative ratio** (worker lag vs in-process lag in the same test).
  Rejected on arithmetic: the monitor returns a **max**, so contention is
  additive on a max and does not cancel. The ratio is
  `max(T,B_w) / max(J,B_in)`; it false-fails once a spike in the worker window
  exceeds `J × threshold` ≈ 350 × 0.6 ≈ **210 ms** — statistically the same
  ceiling as a 200 ms absolute budget, for double the runtime, a threshold to
  tune, and a pool-size trap. It is also *weaker*: a worker path blocking 100 ms
  would pass the ratio while violating today's budget.
- **Isolating perf tests into a separate vitest project.** Rejected: duplicates
  `globalSetup`/`setupFiles` HOME wiring, requires excluding the file from the
  server project (two configs that drift with no guard), adds CI sequencing, and
  is only a soft guarantee — any non-vitest process can still starve the loop.

Non-goals:

- **NOT** raising the budget until it merely stops failing. The value is derived
  from three measured anchors and the derivation ships with it.
- **NOT** skipping, deleting, or weakening P1 — the budget tightens relative to
  the regression signal it must catch, and P2 moves from zero coverage to
  covered.
- **NOT** changing production code. `fit-worker-pool.ts`, `display-fit.ts`, and
  `event-loop-lag.ts` are untouched.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `attachment-storage`: the two scenarios under "Fitting SHALL NOT block the
  server" get a stated, derived budget in place of an unquantified "its budget",
  and the concurrent-paste scenario gains the automated coverage it currently
  lacks. The requirement's intent is unchanged; the scenarios become checkable.

`parallel-test-execution` is **deliberately not modified.** An earlier draft
added a cross-suite "perf assertions SHALL be comparative" requirement there;
that spec governs parallelization infrastructure and its own requirements are
absolute timeout budgets, so the addition would have contradicted it and
overreached the evidence.

## Impact

Affected code — test-only:

- `packages/server/src/attachments/__tests__/display-fit-perf.test.ts` —
  `MAX_LAG_MS` 50 → 200 with the derivation table in a comment; P2 un-skipped and
  re-targeted to a worker-path budget assertion; the stale P2 commentary (which
  records the disproven 0 ms and recommends a throughput gate) corrected.

Affected docs:

- This change's `design.md` carries the **D4 corrigendum**. The archived design
  doc is left immutable per archive convention; the correction lives here and in
  the test-file comment, which is what a future reader actually opens.

Measurement discipline the implementation must honour (each caused a wrong
conclusion during drafting):

- **Warm the pool** before sampling, so worker spawn / jiti-compile cost stays
  out of the measured window (P1 already does this).
- **Model the regression faithfully** — `useWorker: false, size: 2`, not the
  default size 1.
- **Re-verify outside vitest** when a number looks surprising. That is what
  separated the real signal from D4's artifact.

Affected systems:

- **Test wall-time.** P2 un-skipping adds one worker-path burst (~1.2 s). P1 is
  unchanged in cost.
- **`npm test` ergonomics.** Unchanged — same project, runs by default, no new
  config, no opt-in flag, no vitest config touched.

Not affected: production runtime, attachment ingest behaviour, the browser
gateway, and the public API surface.

## Discipline Skills

- `performance-optimization` — measure-first: the budget is derived from recorded
  anchors, and the inherited anchors were re-verified rather than trusted.
- `systematic-debugging` — root cause established by re-measuring the prior
  claim on its own workload.
- `doubt-driven-review` — the gate must not be vacuous: verify it still fails
  under a forced `useWorker: false, size: 2` fallback.
- `review-code` — before the change lands.
