## 1. Make the harness testable

Every decision-rule test below needs importable pure functions. `analyze.mjs` and
`extract.mjs` are currently CLI-only, and a rule this load-bearing cannot be
verified by scraping stdout.

- [ ] 1.1 Extract `analyze.mjs` scoring logic into exported pure functions (rate-per-tell, bootstrap, criteria evaluation, verdict) with the CLI as a thin wrapper; verify the existing CLI output on `rows-plain-language.jsonl` is byte-identical before and after
- [ ] 1.2 Export `extract.mjs` row-parsing as a pure function taking parsed JSONL + runner status; verify existing extract output on the prior change's runs is unchanged
- [ ] 1.3 Create `scripts/__tests__/ab-context-rules.test.mjs` (exemplar: `scripts/__tests__/check-conventions.test.mjs`) with a fixture builder for synthetic rows; verify an empty suite runs green under `npx vitest run scripts/__tests__/ab-context-rules.test.mjs`

## 2. Eligibility, endpoint selection, and the ABORT rule

- [ ] 2.1 Implement eligibility (control ≤0.60 on hard-6 AND CI upper ≤0.70) and verify the boundary test passes: control rate exactly 0.60 with CI upper 0.68 · evaluate eligibility · tell IS eligible (test-plan #E1)
- [ ] 2.2 Verify the just-above boundary rejects: control rate 0.601 · evaluate eligibility · tell NOT eligible (test-plan #E2)
- [ ] 2.3 Verify the CI bound vetoes a passing point estimate: control rate 0.55 with CI upper 0.72 · evaluate eligibility · NOT eligible (test-plan #E3)
- [ ] 2.4 Verify eligibility uses the hard-6 task set only: tell at 0.85 on hard-6 but 0.58 pooled over all 8 (2 ceiling controls at 1.0) · evaluate eligibility · NOT eligible (test-plan #E4)
- [ ] 2.5 Implement the ABORT rule and verify: no tell ≤0.60 on control · run verdict · verdict is `abort-null`, treatment arms not scored, no endpoint emitted (test-plan #E5)
- [ ] 2.6 Implement mechanical endpoint selection by the declared priority order and verify: `no_hedging` and `short_sentences` eligible, `jargon_defined` not · select endpoint · `no_hedging` chosen, and selection is a pure function of the order with no dependence on arm deltas (test-plan #E6)

## 3. The win criteria

- [ ] 3.1 Implement criterion 1 and verify the win boundary: primary delta +0.20 with bootstrap CI on the difference excluding 0 · evaluate · criterion 1 PASSES (test-plan #E7)
- [ ] 3.2 Verify the just-below threshold fails: primary delta +0.199, CI excludes 0 · evaluate · criterion 1 FAILS (test-plan #E8)
- [ ] 3.3 Verify significance is required: primary delta +0.35, CI on the difference includes 0 · evaluate · criterion 1 FAILS (test-plan #E9)
- [ ] 3.4 Implement criterion 2 as evidence-of-harm and verify a large-but-insignificant drop passes: secondary tell drop 0.15, CI includes 0 · evaluate · criterion 2 PASSES (test-plan #E10)
- [ ] 3.5 Verify a significant drop past δ fails: secondary tell drop 0.15, CI excludes 0 · evaluate · criterion 2 FAILS (test-plan #E11)
- [ ] 3.6 Verify guards pool over all 8 tasks: arm regresses ONLY on the 2 ceiling-control tasks · evaluate · criterion 2 FAILS (control-only damage stays visible) (test-plan #E12)
- [ ] 3.7 Implement criterion 3 and verify it can veto a strong primary: `keeps_identifiers` drops 0.20 significantly while primary is +0.30 · run verdict · NOT a win (test-plan #E13)
- [ ] 3.8 Implement criterion 4 with the +5% margin and verify an insignificant overrun passes: output tokens +6%, not significant · evaluate · criterion 4 PASSES (test-plan #E14)
- [ ] 3.9 Verify a significant overrun fails: output tokens +6%, significant · evaluate · criterion 4 FAILS (test-plan #E15)
- [ ] 3.10 Implement Bonferroni over the 2 treatment arms and verify: arms B and C evaluated against the shared control · run verdict · each arm tested at 97.5%, not 95% (test-plan #E16)
- [ ] 3.11 Implement the tie-break and verify: B and C both satisfy all criteria · run verdict · arm C (scoped) adopted (test-plan #E17)
- [ ] 3.12 Implement per-class tell applicability and verify: rows of the low-confidence class · score `no_hedging` · the tell is EXCLUDED on that class, not failed (test-plan #E18)
- [ ] 3.13 Implement the valid-N floor and verify: a cell with 7 of 10 runs valid after one re-run · run verdict · stage reported INVALID and no verdict emitted (test-plan #E19)

## 4. The judge gate

- [ ] 4.1 Implement the gate-closed rule and verify adopt is unreachable: criteria 1–4 all pass with the gate never opened · run verdict · verdict is `null` (test-plan #E20)
- [ ] 4.2 Implement criterion 5 with δ=0.5 on the 1–5 axis and verify the boundary: judge "understandable" drops 0.5 significantly · evaluate · criterion 5 FAILS (test-plan #E21)
- [ ] 4.3 Implement the validation standard and verify it holds the gate shut below the bar: 5 of 8 hand labels within ±1 · evaluate gate · gate stays CLOSED (needs ≥6 of 8) (test-plan #E22)
- [ ] 4.4 Raise `JUDGE_TIMEOUT` from its 420 s default to exceed the measured >600 s call latency; verify the configured value is read and applied

## 5. Statistics

- [ ] 5.1 Implement the cluster bootstrap and verify the resampling unit: identical rows resampled at run level vs task-cluster level · compute CI · cluster-level CI is strictly wider, and the implementation uses cluster-level (test-plan #E24)
- [ ] 5.2 Verify pairing: all arms share the same 8 tasks · compute CI · the same task set is drawn for every arm within each resample (test-plan #E25)
- [ ] 5.3 Implement the BCa fallback and verify: acceleration undefined at K=6 (degenerate jackknife) · compute CI · falls back to the percentile interval and records which method was used (test-plan #E26)
- [ ] 5.4 Verify analysis throughput: 240 rows × 7 checks with 10 000 resamples · run analyze · completes in under 30 s (test-plan #P1)

## 6. Runner and invalidity handling

- [ ] 6.1 Add `ARMS_FILE` support to `run.sh` and verify the default path is preserved: no `ARMS_FILE` in env · startup · reads `./arms.json` (test-plan #X6)
- [ ] 6.2 Verify a bad `ARMS_FILE` fails loudly: `ARMS_FILE` points at a nonexistent/unparseable file · startup · exits non-zero with a clear message and does NOT fall back to `arms.json` (test-plan #X5)
- [ ] 6.3 Capture `timeout` exit code 124 in `run.sh` and write a per-run status sidecar; verify: `timeout` kills a run · post-run · the sidecar records exit 124 (test-plan #X1)
- [ ] 6.4 Teach `extract.mjs` to honour runner status and verify the truncation hole is closed: transcript has partial assistant text AND non-zero runner status · parse · row marked `invalid` with all checks `na` (test-plan #X2)
- [ ] 6.5 Verify the existing zero-text guard still holds: zero assistant text · parse · row marked `invalid` and negative regex checks do NOT score as passes (test-plan #X3)
- [ ] 6.6 Verify invalid runs stay out of efficiency means: one invalid run with all-zero usage in an arm · analyze · run excluded from the mean and the excluded count reported (test-plan #X4)
- [ ] 6.7 Verify a total provider failure does not masquerade as a clean result: provider returns 404 for every call · stage runs · all runs invalid and the stage fails the valid-N floor (test-plan #X7)
- [ ] 6.8 Verify fresh-`OUT` isolation: a stale `runs-plain-language/` from the prior change is on disk · extract over this stage's `OUT` · prior-battery runs are NOT folded into the aggregates (test-plan #X8)
- [ ] 6.9 Set per-stage timeouts (flash 900 s, opus 3600 s) and verify each stage launches with its configured value

## 7. Host-health precondition

- [ ] 7.1 Implement the health predicate and verify both sides of the boundary: swap 3.9 GB / load 3.9 then swap 4.1 GB / load 3.9 · evaluate · first PASSES, second BLOCKS (test-plan #E23)

## 8. The battery

- [ ] 8.1 Author `scripts/ab-context/tasks-plain-language-hard.jsonl`: 8 tasks — 6 hard-class (open-ended design, ambiguous, bad-news, low-confidence, long synthesis) plus 2 retained closed-question ceiling controls; verify it parses and every task declares its per-task `answer_first` anchors and required identifier set
- [ ] 8.2 Author `scripts/ab-context/arms.plain-language-hard.json` (3 worktree arms) and a control-only arms map for the stage-1 shakeout; verify `run.sh` accepts both via `ARMS_FILE`
- [ ] 8.3 Invoke the `review-code` discipline skill on tasks 1–6 before any number derived from them is trusted — the last change to `analyze.mjs` inverted a verdict and was caught only by review

## 9. Documentation and closeout

- [ ] 9.1 Update `scripts/ab-context/AGENTS.md` rows for every changed/added file (`analyze.mjs`, `extract.mjs`, `run.sh`, the new battery and arms maps) per the WRITE discipline
- [ ] 9.2 Run the repo test suite and verify no test regressed (`set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log`)

## 10. Manual verification (deferred post-merge — NOT executed by this change)

The user has explicitly scoped this change to planning and harness work. The
experiment is not run here.

- [ ] 10.1 Human reviews the 6 hard-class prompts and judges whether a competent responder would plausibly preamble/hedge/bury on each (test-plan: manual-only)
- [ ] 10.2 Human hand-scores 8 arm-blinded transcripts 1–5 before the judge sees them, to supply the labels the gate is validated against (test-plan: manual-only)
- [ ] 10.3 Human confirms the host reaches swap < 4 GB and load < 4 before any stage starts (test-plan: manual-only)
- [ ] 10.4 Human starts the staged experiment run when ready (test-plan: manual-only)
