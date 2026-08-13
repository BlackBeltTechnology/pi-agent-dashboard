# Follow-ups — fix-kb-search-retrieval-quality

Deferred deliberately. Each carries why it is not in this change.

## 1. Query-refinement hints in tool output

The originally requested feature. Still deferred, for the reason `design.md`
gives: the agent already knows its query failed (it retried 33.8% of the time in
the re-mined data) and reformulates by near-random synonym churn. Hints are cheap
now that PRF term mining exists (`prfTerms()`), but they sit downstream of four
larger causes and remain unmeasured.

Revisit only with a way to measure whether a hint changes the next action.

## 2. The fall-through rate is still unmeasured — and NOT via `ab-context`

Nothing in this change proves the 41.3% fall-through drops. Offline Recall@K is
not behaviour.

**Do NOT repoint `scripts/ab-context` at the mined real queries.** Tested
2026-08-06 ($20.47, 30 runs): field-framed prompts score identically to
archetype-framed ones (100% vs 100%, p = 1.0). The battery is not cued — the gap
is environmental. `pi -p` runs a cold single-turn session where the agent has no
prior context, so it scores 100% kb-first and 0% grep fall-through against the
field's 41.3%. The harness cannot reproduce the condition under which the
doctrine fails.

To gate this, `ab-context` needs multi-turn warm-context fixtures. Absent those,
accept that it cannot gate this change. See `ab-context-calibration.md`.

## 3. Coverage rerank + PRF are shipped OFF, not abandoned

Implemented, tested, config-gated (`ranking.coverageRerank`,
`queryExpansion.mode`). On this corpus (96.4% `doc` chunks) they trade a large
markdown-intent loss for a real source-intent gain and come out net negative.

They are the right default for a **source-shaped** query mix: P@5 0.337 → 0.481,
MRR 0.198 → 0.281 on the source-intent set. Revisit when the code plane
(`add-codegraph-code-plane`) shifts the query mix, and re-run
`packages/kb/eval/run-fixtures.ts` before flipping either default.

## 4. Lane-quota latency: make the `agents` lane indexable

The reserved lane is a second FTS query, and `doc_type` is an `UNINDEXED` FTS5
column, so it cannot be answered by an index — it scans the whole match set.
That is the entire latency delta (25.5 ms → 53.2 ms median). The shipped budget
is therefore stated as a median, with a documented p95 overage.

Options, none cheap enough for this change: a separate FTS table per doc type,
an external content table with a real index on `doc_type`, or a prefix-token
trick (`__agents` injected into an indexed column).

## 5. `dox lint --source-rows` is off by default — 70 open findings

The D9 source-file arm reports 70 undocumented `.ts`/`.tsx` files in this repo.
Default-off precisely so it does not red-wall CI on day one. Adopting it means
writing 70 purpose rows; it is never auto-fixed, because a blank purpose row is
worse than an honest finding.

## 6. `expandParent` costs more than everything in this change

Measured while isolating this change's latency: `expandParent` (pre-existing,
default ON) costs ~180 ms median at baseline versus ~21 ms with it off — an order
of magnitude more than source dedup and the lane quota combined. It issues one
`getChunkById` per hit.

Entirely untouched here. It is the single largest search-latency lever in the
KB and deserves its own change (batch the parent fetch into one `IN (...)`
query).

## 7. `mmr()` is effectively dead code

`search()` calls `mmr(hits, bodies, lambda, fetch)` with `fetch` — the raw pool
size — as the limit, and `mmr` returns early unless `ranked.length > limit`,
which cannot happen. So `ranking.diversity.enabled: true` advertises a knob that
never fires. Pre-existing (predates this change), surfaced by review.

Either pass the real `limit` or drop the config knob — but note that source
dedup now covers the redundancy case MMR was reached for, so deleting it is the
likelier right answer. `design.md` Open Questions asks exactly this.
