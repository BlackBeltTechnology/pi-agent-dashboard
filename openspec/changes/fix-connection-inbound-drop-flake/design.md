# Design — fix-connection-inbound-drop-flake

## D1 — Median-of-interleaved-rounds with paired per-round ratios (chosen)

Run K=7 rounds; each round measures one baseline flood and one with-report
flood **back-to-back**. Assert `median(withReport_i / baseline_i) < 1.1`
OR `median(withReports) − median(baselines) < 5` (absolute floor, same OR
shape as the original `max` bound).

Why paired ratios: a sustained slow window (GC phase, runner throttle)
inflates **both** samples of a back-to-back pair equally, so the per-round
ratio cancels window-level load entirely — cross-series medians were tried
first and still failed 1/3 under 64-spinner contention (a slow window shifts
the with-report series as a whole) — paired ratios passed 5/5 under the
identical load. Why K=7: the median tolerates up to 3 corrupted rounds,
matched to the observed CI spike rate, while keeping the test under ~1 s.
Why the absolute floor: preserves the original bound's protection at tiny
baselines where ratios are noisy; it is an OR fallback, so a slow window
cannot produce a false-green (it inflates the difference too).

## D2 — Keep the budget, not a wider one

The 10 %/+5 ms bound is untouched. Widening it would weaken the overhead guard
the parent change (fix-spawn-correlation-ttl-coupling, test-plan P2) put in
place; the robust estimator alone removes the flake. assertNoWeakening
applies: assertion strength is preserved (same bound, stronger measurement).

## D3 — Verification under synthetic contention

Local verification reproduces the CI failure mode: run the test file while a
CPU spinner load competes for the core. The old methodology fails under
contention; the new methodology passes the same contention. This is the
red/green demonstration — the change's own deliverable is the robust test, so
TDD's "red" is demonstrated against the OLD test body (documented in
tasks.md), not asserted by a unit test of the test.

## D4 — Alternatives rejected

- **Retry loop around the old assertion**: hides real regressions (a retry
  that passes on flake also passes on genuine +8 % overhead).
- **Widen the bound to 25 %**: weakens the guard for a measurement problem;
  rejected per D2.
- **Drop the perf test**: loses the only guard on the reporting hot path.
- **`vi.setSystemTime` / fake timers**: the test measures real dispatch cost;
  fake timers measure nothing here.
