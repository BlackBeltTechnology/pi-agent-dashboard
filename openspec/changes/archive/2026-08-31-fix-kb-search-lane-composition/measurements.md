# Measurements — fix-kb-search-lane-composition

All numbers from `tsx packages/kb/eval/run-fixtures.ts`, indexing this repo
(3064 files / 33978 chunks, `--fresh`), K=10.

## 0. Instrument defect found at task 1.3 (fixed in task 1.4)

The first baseline run reported **source-intent n=0** and **markdown-intent n=12**.

Cause: `run-fixtures.ts` called `evaluate(store, items, { ...opts, k: K })` and never
passed `roots`. `evaluate` builds its reachability sets from `roots ?? []` (design D4 of
`fix-kb-eval-measurement-integrity`), so with no roots both `firstSegs` and `topSegs` are
empty and **every expect containing a separator is ruled unreachable**. All 104
source-intent expects are repo-relative paths; only the 12 bare-basename markdown items
were ever scored.

Fix: pass `roots: [{ id: "repo", relPrefix: "", dir: REPO }]` and throw on a zero-scored
fixture, so a harness misconfiguration can never again render as a catastrophic
regression. Post-fix: source-intent n=104/104, markdown-intent n=73/108 (35 expects point
outside the repo root and stay legitimately unreachable).

Every number below is post-fix.

## 1. Pre-change baseline (task 1.2)

| variant | set | n | P@1 | P@5 | R@10 | MRR |
|---|---|---|---|---|---|---|
| baseline (pre-change) | markdown-intent | 73 | 0.151 | 0.356 | 0.425 | 0.233 |
| baseline (pre-change) | source-intent | 104 | 0.048 | 0.106 | 0.173 | 0.077 |
| + source dedup (D1/D2) | markdown-intent | 73 | 0.151 | 0.452 | 0.534 | 0.271 |
| + source dedup (D1/D2) | source-intent | 104 | 0.048 | 0.163 | 0.308 | 0.103 |
| + lane quota (D3) | markdown-intent | 73 | 0.151 | 0.438 | 0.575 | 0.264 |
| + lane quota (D3) | source-intent | 104 | 0.048 | 0.346 | 0.452 | 0.187 |
| + coverage rerank (D4a) | markdown-intent | 73 | 0.151 | 0.384 | 0.507 | 0.244 |
| + coverage rerank (D4a) | source-intent | 104 | 0.115 | 0.375 | 0.519 | 0.246 |
| + PRF (D4b) | markdown-intent | 73 | 0.110 | 0.329 | 0.425 | 0.195 |
| + PRF (D4b) | source-intent | 104 | 0.135 | 0.394 | 0.558 | 0.265 |

## 2. Task 1.3 — does the baseline reproduce the proposal's shape?

Yes. On the shipped-default lane configuration (`+ lane quota (D3)`), source-intent
**P@1 0.048** against **Recall@10 0.452** — a 9.4x gap, the same shape the proposal
measured at mining time (0.041 vs 0.495) on its n=97 snapshot. The reserved lane earns
page share but never slot 1, exactly as design D1 predicts from the running-share
inequality.

Ranking work may proceed.

## 3. Lane-lead-margin sweep (task 5.3)

`tsx packages/kb/eval/run-fixtures.ts --sweep`. Base = the shipped config through
`searchOptsFromConfig` (`sourceDedup: true`, `laneQuota: 0.5`, `coverageRerank: false`,
`queryExpansion: off`, `expandParent: true`) — i.e. what `kb_search` actually passes.
Every row reports BOTH fixtures; `buildPairedRow` refuses to emit a half-reported row.

n = 104 (source-intent) / 73 (markdown-intent).

| laneLeadMargin | src P@1 | src P@5 | src R@10 | src MRR | md P@1 | md P@5 | md R@10 | md MRR |
|---|---|---|---|---|---|---|---|---|
| 0 (off, reference) | 0.048 | 0.346 | 0.452 | 0.187 | 0.151 | 0.438 | 0.575 | 0.264 |
| 0.1 | 0.058 | 0.327 | 0.452 | 0.186 | 0.151 | 0.452 | 0.575 | 0.265 |
| 0.2 | 0.125 | 0.327 | 0.452 | 0.220 | 0.137 | 0.452 | 0.575 | 0.258 |
| 0.3 | 0.173 | 0.327 | 0.452 | 0.244 | 0.082 | 0.452 | 0.575 | 0.231 |
| 0.5 | 0.212 | 0.327 | 0.452 | 0.263 | 0.110 | 0.452 | 0.575 | 0.244 |

Spot-check row for D2's unchecked interaction (`coverageRerank: true` + PRF on — both
OFF in the shipped config):

| laneLeadMargin | src P@1 | src P@5 | src R@10 | src MRR | md P@1 | md P@5 | md R@10 | md MRR |
|---|---|---|---|---|---|---|---|---|
| 0 +cov+prf | 0.135 | 0.394 | 0.558 | 0.265 | 0.110 | 0.329 | 0.425 | 0.195 |
| 0.2 +cov+prf | 0.163 | 0.404 | 0.558 | 0.276 | 0.082 | 0.329 | 0.425 | 0.183 |

Shape of the effect on the shipped stack: P@1 and MRR rise with the margin, R@10 is flat
at 0.452 across the whole axis, and source P@5 drops 0.346 → 0.327 (two queries) the moment
the rule turns on and stays there. So the rule is not purely additive at rank 1 — leading
with an `agents` hit costs a doc hit its top-5 slot in two queries — but it changes the
ORDER of the page far more than its contents (R@10 unmoved).

Harness drift, as designed-for: the eval harness has no resolved sources, so
`searchOptsFromConfig` yields `rootPriority: {}` here while the deployed tool passes real
root priorities. Accepted (design D6 risk register).

## 4. Default selection against the D6 bar (task 5.4)

Bar: source-intent ΔP@1 ≥ **+0.03** AND markdown-intent ΔP@1 ≥ **−0.01**, smallest
clearing margin wins.

| margin | Δ src P@1 | source bar | Δ md P@1 | markdown bar | verdict |
|---|---|---|---|---|---|
| 0.1 | +0.010 | ✗ | +0.000 | ✓ | fails |
| 0.2 | +0.077 | ✓ | −0.014 | ✗ | fails |
| 0.3 | +0.125 | ✓ | −0.069 | ✗ | fails |
| 0.5 | +0.164 | ✓ | −0.041 | ✗ | fails |

**No margin on the design's grid clears both halves. Shipped default: `laneLeadMargin: 0`
(rule off).**

Rationale, and the honest caveat: at n=73 one markdown query is worth 0.0137 P@1, so the
−0.01 tolerance is **narrower than a single query** — any non-zero markdown regression
fails it by construction. Margin 0.2 misses by exactly one query while buying 8 source
queries. That is a tempting trade, and it is exactly the trade the design forbade being
made by vibes: the bar was fixed before the numbers were seen, and it is not being moved
after seeing them. Nor was the grid searched off-design for a value that squeaks through —
D6 explicitly warns that a margin tuned on ~100 mined queries overfits.

What ships instead: the knob itself (opt-in via `ranking.laneLeadMargin`), the `doc_type`
description + prompt guideline (D4), and the record-type marks (D5) — the discoverability
half, which needs no ranking trade-off at all. The measured escape hatch
(`doc_type: "agents"`, 5.5x P@1 on file-lookup queries) is now described in the schema, so
the agent can choose the lane per query instead of a global default choosing for it.

Re-open the default when the markdown fixture is large enough for the −0.01 tolerance to
mean more than one query.

## 5. The `doc_type` lane trade-off, reproduced on the fixed instrument (task 3.5)

The doctrine in root `AGENTS.md` cited mining-time numbers from an uncommitted harness.
Re-measured here on the committed fixtures through the shipped config:

| fixture | filter | n | P@1 | P@5 | R@10 | MRR |
|---|---|---|---|---|---|---|
| source-intent | unfiltered | 104 | 0.048 | 0.346 | 0.452 | 0.187 |
| source-intent | `doc_type: "agents"` | 104 | **0.231** | 0.442 | 0.567 | 0.327 |
| markdown-intent | unfiltered | 73 | 0.151 | 0.438 | 0.575 | 0.264 |
| markdown-intent | `doc_type: "agents"` | 73 | **0.068** | 0.151 | 0.205 | 0.110 |

The mining-time claim survives: 4.8x P@1 on file-lookup queries, and a 2.2x P@1 LOSS on
conceptual ones. The filter is a per-query lane choice, never a default — which is exactly
what the new schema description and prompt guideline say. Root `AGENTS.md` now cites these
reproducible numbers instead of the mining-time snapshot.
