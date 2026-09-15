# Test Plan — retest-plain-language-hard-battery

Stage: design   Generated: 2026-09-15

No clarifications outstanding: every Triple slot resolves against the parameters
fixed in `proposal.md` (eligibility ≤60% / CI-upper ≤70%, primary +20pp with CI
excluding zero, guard δ=0.10 evidence-of-harm, cost +5%, judge δ=0.5, N, per-stage
timeouts, valid-N floor, Bonferroni, tie-break).

**What is under test here is the *decision machinery*, not the experiment's
answer.** The prior change's verdict was inverted by an unnoticed bug in
`analyze.mjs`; these scenarios exist so that cannot recur. The experiment run
itself is `manual-only` and explicitly out of scope for this change.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | eligibility cut | BVA | L1 | automated | control rate exactly 0.60 on hard-6, CI upper 0.68 | evaluate eligibility | tell IS eligible |
| E2 | eligibility cut | BVA | L1 | automated | control rate 0.601 | evaluate eligibility | tell NOT eligible |
| E3 | eligibility CI bound | BVA | L1 | automated | control rate 0.55, CI upper 0.72 | evaluate eligibility | NOT eligible (CI upper > 0.70) despite point estimate passing |
| E4 | eligibility task set | decision-table | L1 | automated | tell at 0.85 on hard-6, 0.58 pooled over all 8 (2 ceiling controls at 1.0) | evaluate eligibility | NOT eligible — eligibility uses hard-6 only, never the 8-task pool |
| E5 | ABORT rule | state-transition | L1 | automated | no tell ≤0.60 on control | run verdict | verdict = `abort-null`; treatment arms are NOT scored and no primary endpoint is emitted |
| E6 | endpoint priority order | decision-table | L1 | automated | `no_hedging` and `short_sentences` both eligible, `jargon_defined` not | select endpoint | `no_hedging` selected (higher in declared order); selection is a pure function of the order, not of arm deltas |
| E7 | primary win threshold | BVA | L1 | automated | primary delta +0.20, bootstrap CI on difference excludes 0 | evaluate criterion 1 | criterion 1 PASSES |
| E8 | primary win threshold | BVA | L1 | automated | primary delta +0.199, CI excludes 0 | evaluate criterion 1 | criterion 1 FAILS |
| E9 | primary win requires significance | BVA | L1 | automated | primary delta +0.35, CI on difference includes 0 | evaluate criterion 1 | criterion 1 FAILS |
| E10 | guard = evidence of harm | decision-table | L1 | automated | secondary tell drop of 0.15, CI on difference includes 0 | evaluate criterion 2 | criterion 2 PASSES — a drop past δ is not a failure without significance |
| E11 | guard = evidence of harm | decision-table | L1 | automated | secondary tell drop 0.15, CI excludes 0 | evaluate criterion 2 | criterion 2 FAILS |
| E12 | guard pooling set | decision-table | L1 | automated | arm regresses ONLY on the 2 ceiling-control tasks | evaluate criterion 2 | criterion 2 FAILS — guards pool over all 8 tasks, so control-only damage is visible |
| E13 | identifier retention | decision-table | L1 | automated | `keeps_identifiers` drops 0.20, CI excludes 0, primary +0.30 | run verdict | NOT a win — criterion 3 vetoes |
| E14 | cost margin | BVA | L1 | automated | output tokens +6%, difference not significant | evaluate criterion 4 | criterion 4 PASSES |
| E15 | cost margin | BVA | L1 | automated | output tokens +6%, difference significant | evaluate criterion 4 | criterion 4 FAILS |
| E16 | arm multiplicity | decision-table | L1 | automated | arms B and C each evaluated vs shared control | run verdict | each arm tested at 97.5%, not 95% (Bonferroni over 2 arms) |
| E17 | tie-break | decision-table | L1 | automated | B and C both satisfy all criteria | run verdict | arm C (scoped) is adopted |
| E18 | tell applicability | decision-table | L1 | automated | battery rows of the low-confidence class | score `no_hedging` | `no_hedging` is NOT scored on that class (excluded, not failed) |
| E19 | valid-N floor | BVA | L1 | automated | a cell with 7 of 10 runs valid after one re-run | run verdict | stage reported INVALID; no verdict emitted (never silently under-powered) |
| E20 | judge gate closed | state-transition | L1 | automated | criteria 1–4 all pass, judge gate never opened | run verdict | verdict = `null`, adopt is unreachable — regex-only can never adopt |
| E21 | judge NI margin | BVA | L1 | automated | judge "understandable" drop of 0.5 on the 1–5 axis, significant | evaluate criterion 5 | criterion 5 FAILS at the boundary |
| E22 | judge validation standard | BVA | L1 | automated | 5 of 8 hand labels within ±1 | evaluate gate | gate stays CLOSED (needs ≥6 of 8) |
| E23 | host-health predicate | BVA | L1 | automated | swap 3.9 GB / load 3.9, then swap 4.1 GB / load 3.9 | evaluate precondition | first PASSES, second BLOCKS |
| E24 | bootstrap unit | state-transition | L1 | automated | identical rows resampled at run level vs task-cluster level | compute CI | cluster-level CI is strictly wider; the implementation uses cluster-level |
| E25 | bootstrap pairing | decision-table | L1 | automated | all arms share the same 8 tasks | compute CI | resampling is paired by task (same task set drawn for every arm per resample) |
| E26 | BCa fallback | fault-injection | L1 | automated | BCa acceleration undefined at K=6 (degenerate jackknife) | compute CI | falls back to percentile interval and records which method was used |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | runner records invalidity | fault-injection (abort) | L1 | automated | `timeout` kills a run → exit code 124 | `run.sh` post-run | a status sidecar records exit 124 for that run |
| X2 | truncated transcript | fault-injection (abort) | L1 | automated | transcript has partial assistant text AND non-zero runner status | `extract.mjs` parse | row marked `invalid`, all checks `na` — the zero-text guard alone would have scored it |
| X3 | empty transcript (regression guard) | fault-injection | L1 | automated | zero assistant text | `extract.mjs` parse | row marked `invalid`; negative regex checks do NOT score as passes |
| X4 | invalid runs excluded from means | fault-injection | L1 | automated | one invalid run with all-zero usage in an arm | `analyze.mjs` efficiency | that run is excluded from the arm's mean; the excluded count is reported (the exact defect that inverted arm B's token delta) |
| X5 | `ARMS_FILE` malformed | fault-injection | L1 | automated | `ARMS_FILE` points at a nonexistent/unparseable file | `run.sh` startup | exits non-zero with a clear message; does NOT silently fall back to `arms.json` |
| X6 | `ARMS_FILE` unset | fault-injection | L1 | automated | no `ARMS_FILE` in env | `run.sh` startup | reads `./arms.json` (back-compat with the existing harness preserved) |
| X7 | provider error mid-stage | fault-injection (abort) | L1 | automated | provider returns 404 for every call (the `google/*` failure mode) | stage runs | every run marked invalid; stage fails the valid-N floor rather than reporting a clean null |
| X8 | fresh OUT isolation | fault-injection | L1 | automated | a stale `runs-plain-language/` from the prior change sits on disk | `extract.mjs` glob over this stage's `OUT` | prior-battery runs are NOT folded into this experiment's aggregates |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | analysis is not the bottleneck | threshold | L1 | automated | 240 rows × 7 checks, 10 000 bootstrap resamples | wall clock < 30 s | single run |

### Frontend-quirk

None. This change touches no rendered UI — there is no client surface, no
WebSocket-driven view, and no DOM. Recording the absence explicitly so the empty
section is not mistaken for an oversight.

### Manual-only

| id | requirement | technique | level | disposition | surface | trigger | expected observable |
|----|-------------|-----------|-------|-------------|---------|---------|---------------------|
| M1 | battery elicits the tells | human judgment | — | manual-only | the 6 hard-class prompts | human reads each prompt | [judgment: would a competent responder plausibly preamble/hedge/bury here? — no automatable observable] |
| M2 | judge hand-labeling | human judgment | — | manual-only | 8 arm-blinded transcripts | human scores 1–5 before the judge sees them | [judgment: the labels themselves are the human input the gate is validated against] |
| M3 | host reaches the health threshold | environment | — | manual-only | the physical machine | human waits for / frees memory | [environmental: swap < 4 GB, load < 4 — the predicate is tested at E23; actually reaching it is not automatable] |
| M4 | the experiment run itself | execution | — | manual-only | all stages | human starts the staged run | [out of scope for this change by explicit user instruction — planning only, never executed here] |

---

## Coverage summary

- Requirements covered: 26 of 26 testable decision-rule + harness requirements
- Scenarios by class: edge 26 · perf 1 · frontend 0 · error 8 · manual 4
- Scenarios by level: L1 35 · L2 0 · L3 0 · — 4
- Scenarios by disposition: automated 35 · manual-only 4

## New infra needed

None. `scripts/__tests__/*.test.mjs` already exists and is covered by the root
vitest config, so the decision-rule and harness tests have a home
(`scripts/__tests__/check-conventions.test.mjs` is the nearest exemplar).

One implementation consequence: `analyze.mjs`, `extract.mjs` and the `run.sh`
status handling must expose their logic as importable pure functions. They are
currently CLI-only scripts, and a rule this load-bearing cannot be verified
through stdout scraping.
