# Design — fix-connection-inbound-drop-flake

## D1 — Median-of-interleaved-rounds (chosen)

Run K=7 rounds; each round measures one baseline flood and one with-report
flood back-to-back. Collect the baseline samples and with-report samples into
separate arrays; assert `median(withReports) < max(median(baseline)*1.1,
median(baseline)+5)`.

Why medians: a scheduler preemption inserts a one-off spike into exactly one
sample; the median of 7 is immune to up to 3 corrupted samples. Why
interleaved: sequential A-then-B lets slow drift (JIT tier-up, GC heap growth,
thermal throttle) systematically penalize B; alternating A/B/A/B distributes
drift evenly across both series.

Why K=7: 3 corruptable samples per series ≈ observed CI jitter rate; K=7 keeps
the test under ~2 s (7 × 2 × ~20 ms + connect overhead ≈ 0.6 s measured, ×5
safety) while dominating any plausible spike pattern.

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
