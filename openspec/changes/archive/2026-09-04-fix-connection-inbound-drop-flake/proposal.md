# Fix connection-inbound-drop-report CI flake

## Why

`connection-inbound-drop-report.test.ts > adds under 10 % to inbound dispatch
versus a no-report baseline` fails intermittently on CI: 3 consecutive failures
on PR #586 (margins +2.5 % / +4 % / +6 % over the 10 % bound) and 1 failure on
develop itself (run 33371420416), while the identical content passed at 09:02
and on develop at 07:34. The test compares two ~20 ms single-sample wall-clock
floods measured **sequentially**; any scheduler preemption, GC pause or JIT
tier-up landing inside the with-report sample breaks the comparison. The
measured baseline itself swings 15→19 ms across runs (±25 %) while the
production code is unchanged — the estimator, not the overhead, is the defect.

## What Changes

- Rewrite the hot-path overhead measurement in
  `packages/extension/src/__tests__/connection-inbound-drop-report.test.ts` to
  **median-of-interleaved-rounds**: K=7 rounds of (baseline, with-report)
  pairs, compare the **medians** under the existing budget
  (`max(baseline*1.1, baseline+5)`).
- Interleaving removes drift (JIT tiering, GC phase); the median removes
  preemption spikes. The budget's meaning — reporting adds <10 % to inbound
  dispatch — is unchanged; only the estimator is made robust.
- No production code changes.

## Impact

- Files: `packages/extension/src/__tests__/connection-inbound-drop-report.test.ts` (test only)
- Specs: none touched (test-infrastructure robustness; no delta specs)
- Risk: near zero — the assertion still guards the same 10 % overhead budget,
  now measured with an estimator that survives CI-runner jitter.

## Discipline Skills

- `systematic-debugging` — root cause before fix: content-invariant pass/fail
  flip (passed 09:02, failed 09:49+ on the same tree) + baseline swinging ±25 %
  across runs ⇒ measurement jitter, not overhead regression. Applied.
- No other discipline checkpoints fire (no auth/PII, no latency budget in
  production code, no new endpoint, no irreversible step).
