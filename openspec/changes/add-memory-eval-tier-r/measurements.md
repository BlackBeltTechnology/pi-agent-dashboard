# Tier R baseline measurements — old stack, re-measured with the committed harness

Change: `add-memory-eval-tier-r` (umbrella `unify-context-manager`, task 2.1 Tier R).
This file replaces the v0 figures of `docs/research/unified-context-manager-exploration.md` §19 as the reference phase 2 must beat **on the same frozen case set and the same judge**.

Aggregate figures only. Everything below is rendered from the typed aggregate; no case query, context or retrieved snippet is in it (task 8.1: read before commit, nothing reads like session text).

## How it was measured

| item | value |
|---|---|
| command | `memory-eval cases build` → `run` → `judge --judge @propose-review-1` → `report` |
| project | `pi-agent-dashboard` (main checkout), 661 session JSONLs, hermes project `pi-agent-dashboard` |
| case set | `baseline`, hash `559a9cb5cd2010f3fb3af8b948b9706cc06f5d852994b93ad5f0928300707ce4`, seed 5, quotas recurring 60 / negatives 30 |
| cases | recurring_fault 60 (200 candidates), user_flagged 33, explicit_ref 1, negative 30 (212 candidates); 29 signatures excluded (generic or frequent) |
| judge | `@propose-review-1` → `opencode-go/muse-spark-1.3-contributor:high`, prompt `v1` (sha256 `ce8d9ee6…`), 32 calls, 0 failed, 0 unjudged |
| judge choice | the default `@review` (`openai/gpt-6.1-sol:medium`) had no credits on 2026-10-11 (design M8); the operator confirmed the provider before the first call |
| snapshots | hermes: 2,661 sessions, 59,938 messages, 4,911 memories (max message 2026-10-11T11:38Z), 1 attempt; kb: 36,838 chunks over 3,312 files, 1 attempt |
| versions | pi 1.0.0, pi-hermes-memory 0.9.10, replica version 1 |

## Sanity band: flagged, explained

`hermes.session_search.recent` helpful@5 on valid positives is **4/37 = 10.8%** (95% CI 4.3%–24.7%), outside v0's 34% ± 15 points (19/56 = 33.9%). The harness flags this by design; it is a sanity check, not a gate. Three things changed at once and the numbers cannot separate them (design M8):

1. **Own-session exclusion.** v0's replicas had no own-session filter, and §19 reports 26% of `session_search` hits came from the current session. In this run 196 of 580 unexcluded top-5 hits (33.8%) for `recent` were own-session; they are now removed before the top-5 is taken, so every kept hit is cross-session. This lowers recall by construction, and is the intended primary metric.
2. **Judge.** `muse-spark-1.3-contributor:high` instead of `claude-opus-5`, with the v1 prompt ("when in doubt, not helpful"). It is much stricter on validity: 37 of 94 positives (39%) are valid, against 56 of 75 (75%) in v0, and user_flagged is the extreme (9 of 33 valid against 21 of 23). The valid set is therefore small (n = 37), so every interval is wide.
3. **Case set.** 661 session files instead of 502, 124 cases instead of 105 (user_flagged grew 23 → 33 with the EN+HU recurrence regex; recurring_fault 50 → 60 by quota). More user_flagged candidates are noise.

What does carry over from v0: no abstention on negatives for the session retrievers (19/19 valid negatives returned something, judged-helpful 0/19); the distilled memory store is the weakest and the only one that abstains (14/19); and deterministic gold-session hit@10 on recurring faults stays small (bm25 9/60, recent 6/60), so the judge is needed.

## Reading the numbers

- Primary figure for phase 2: **union of the three as-of old-stack retrievers = 7/37 = 18.9%** (95% CI 9.5%–34.2%) on valid positives; phase 2's `sessions` scope must beat it under the same judge, and abstain on the 19 valid negatives (old stack abstains on 14/19 only through `memory_search`).
- `kb.docs` is a non-as-of upper bound (it sees today's docs); it is reported separately and is in no union.
- Per-type rows with n ≤ 9 (user_flagged valid = 9, explicit_ref = 1) are indicative only.
- A phase-2 comparison runs `memory-eval report --compare <baseline-run> <new-run>` on this case set; `--compare` refuses a different case-set hash or judge.

# Full report (rendered, run r20261011T113903)

- case set: baseline (hash 559a9cb5cd2010f3fb3af8b948b9706cc06f5d852994b93ad5f0928300707ce4)
- cases: recurring_fault=60, user_flagged=33, explicit_ref=1, negative=30
- judge: @propose-review-1 → opencode-go/muse-spark-1.3-contributor:high, prompt v1
- verdict coverage: 309 judged, 0 unjudged

## As-of old-stack retrievers

### hermes.memory_search v1 (asOf: strict)

| positives | cases | valid | invalid | validity unjudged | helpful@5 | 95% CI | helpfulness unjudged |
|---|---|---|---|---|---|---|---|
| all positives | 94 | 37 | 57 | 0 | 2/37 (5.4%) | 1.5%–17.7% | unjudged: 0 |
| recurring_fault | 60 | 27 | 33 | 0 | 1/27 (3.7%) | 0.7%–18.3% | unjudged: 0 |
| user_flagged | 33 | 9 | 24 | 0 | 1/9 (11.1%) | 2.0%–43.5% | unjudged: 0 |
| explicit_ref | 1 | 1 | 0 | 0 | 0/1 (0.0%) | 0.0%–79.3% | unjudged: 0 |

Negatives (30 cases, 19 valid, 11 invalid, 0 validity-unjudged):
- returned anything (false injection if delivered): 5/19 (26.3%)
- abstention (returned nothing): 14/19 (73.7%)
- judged-helpful: 1/19 (5.3%) (helpfulness unjudged: 0)

- median injected size: 1300 chars
- as-of violations: 0; under-fill: 0; invalid hits: 0; errors: 0

### hermes.session_search.bm25 v1 (asOf: strict)

| positives | cases | valid | invalid | validity unjudged | helpful@5 | 95% CI | helpfulness unjudged |
|---|---|---|---|---|---|---|---|
| all positives | 94 | 37 | 57 | 0 | 5/37 (13.5%) | 5.9%–28.0% | unjudged: 0 |
| recurring_fault | 60 | 27 | 33 | 0 | 0/27 (0.0%) | 0.0%–12.5% | unjudged: 0 |
| user_flagged | 33 | 9 | 24 | 0 | 4/9 (44.4%) | 18.9%–73.3% | unjudged: 0 |
| explicit_ref | 1 | 1 | 0 | 0 | 1/1 (100.0%) | 20.7%–100.0% | unjudged: 0 |

Negatives (30 cases, 19 valid, 11 invalid, 0 validity-unjudged):
- returned anything (false injection if delivered): 19/19 (100.0%)
- abstention (returned nothing): 0/19 (0.0%)
- judged-helpful: 0/19 (0.0%) (helpfulness unjudged: 0)

- median injected size: 1111.5 chars
- gold-session hit@5 / hit@10 (recurring_fault): 4/60 / 9/60
- gold-session hit@5 / hit@10 (explicit_ref): 1/1 / 1/1
- as-of violations: 0; under-fill: 0; invalid hits: 0; errors: 0
- own-session share of top-5 (before exclusion): 24/580; own-session hits caught by the harness backstop: 0 (adapters exclude in-query)

### hermes.session_search.recent v1 (asOf: strict)

| positives | cases | valid | invalid | validity unjudged | helpful@5 | 95% CI | helpfulness unjudged |
|---|---|---|---|---|---|---|---|
| all positives | 94 | 37 | 57 | 0 | 4/37 (10.8%) | 4.3%–24.7% | unjudged: 0 |
| recurring_fault | 60 | 27 | 33 | 0 | 1/27 (3.7%) | 0.7%–18.3% | unjudged: 0 |
| user_flagged | 33 | 9 | 24 | 0 | 2/9 (22.2%) | 6.3%–54.7% | unjudged: 0 |
| explicit_ref | 1 | 1 | 0 | 0 | 1/1 (100.0%) | 20.7%–100.0% | unjudged: 0 |

Negatives (30 cases, 19 valid, 11 invalid, 0 validity-unjudged):
- returned anything (false injection if delivered): 19/19 (100.0%)
- abstention (returned nothing): 0/19 (0.0%)
- judged-helpful: 0/19 (0.0%) (helpfulness unjudged: 0)

- median injected size: 1116 chars
- gold-session hit@5 / hit@10 (recurring_fault): 3/60 / 6/60
- gold-session hit@5 / hit@10 (explicit_ref): 1/1 / 1/1
- as-of violations: 0; under-fill: 0; invalid hits: 0; errors: 0
- own-session share of top-5 (before exclusion): 196/580; own-session hits caught by the harness backstop: 0 (adapters exclude in-query)

### recall (blackhole)

0% by construction: its scope is the current session only, so it never answers a cross-session case.

### Union — any of hermes.memory_search, hermes.session_search.bm25, hermes.session_search.recent helpful

Over the cases judged for every constituent. Overall: 7/37 (18.9%) (95% CI 9.5%–34.2%), n = 37.
- recurring_fault: 2/27 (7.4%) (95% CI 2.1%–23.4%), n = 27
- user_flagged: 4/9 (44.4%) (95% CI 18.9%–73.3%), n = 9
- explicit_ref: 1/1 (100.0%) (95% CI 20.7%–100.0%), n = 1

### Sanity band

hermes.session_search.recent helpful@5 = 4/37 (10.8%); v0 reference 34% ± 15 points: **FLAGGED — outside the band; explain before committing** (case set, judge or own-session exclusion may differ from v0).

## Non-as-of references (not in the union, not an as-of claim)

### kb.docs v1 (asOf: none)

| positives | cases | valid | invalid | validity unjudged | helpful@5 | 95% CI | helpfulness unjudged |
|---|---|---|---|---|---|---|---|
| all positives | 94 | 37 | 57 | 0 | 4/37 (10.8%) | 4.3%–24.7% | unjudged: 0 |
| recurring_fault | 60 | 27 | 33 | 0 | 3/27 (11.1%) | 3.9%–28.1% | unjudged: 0 |
| user_flagged | 33 | 9 | 24 | 0 | 1/9 (11.1%) | 2.0%–43.5% | unjudged: 0 |
| explicit_ref | 1 | 1 | 0 | 0 | 0/1 (0.0%) | 0.0%–79.3% | unjudged: 0 |

Negatives (30 cases, 19 valid, 11 invalid, 0 validity-unjudged):
- returned anything (false injection if delivered): 19/19 (100.0%)
- abstention (returned nothing): 0/19 (0.0%)
- judged-helpful: 0/19 (0.0%) (helpfulness unjudged: 0)

- median injected size: 438.5 chars
- as-of violations: 0; under-fill: 0; invalid hits: 0; errors: 0

