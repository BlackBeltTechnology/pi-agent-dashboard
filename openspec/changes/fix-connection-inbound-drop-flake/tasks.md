# Tasks — fix-connection-inbound-drop-flake

## 1. Root-cause evidence (done during proposal)

- [x] 1.1 Collect failure evidence: PR #586 runs 33377314670 (3 failures:
      +2.5 %/+4 %/+6 %), develop run 33371420416; pass evidence: PR first round
      09:02, develop 07:34 — content-invariant flip.
- [x] 1.2 Read the measurement: sequential single-sample A/B wall-clock over
      ~20 ms floods (test body, lines 244–255); baseline swings 15→19 ms
      across runs.

## 2. Implement robust measurement

- [x] 2.1 Demonstrate the red: run the CURRENT test under synthetic CPU
      contention and observe failure (record command + result in the PR).
- [x] 2.2 Rewrite the overhead test to median-of-interleaved-rounds per
      design D1 (K=7, same budget via `max(baseline*1.1, baseline+5)` on
      medians); keep the existing warmup floods.
- [x] 2.3 Green: the new methodology passes the same contention load
      (record command + result), and passes clean 10 consecutive local runs.

## 3. Gates

- [x] 3.1 `npm test` full suite: only the documented pre-existing failures
      remain (or green); the reworked test green.
- [x] 3.2 Enforcers: check-conventions, knip pair (see ship-it 4.4) — docs
      may not regress; no baseline raise.
- [x] 3.3 Review checkpoint (ship-it 4.5) — required, @review.

## 4. Ship

- [ ] 4.1 PR against develop; watch CI (the flake must NOT reproduce on the
      new methodology across the CI run).
- [ ] 4.2 After merge: re-base PR #586 onto the fixed develop, re-run its CI,
      land it.
