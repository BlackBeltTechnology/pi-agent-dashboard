## Context

`store.search()` in `packages/kb/src/sqlite-store.ts` is a single SQL query
against one FTS5 table, post-processed by an optional dedup / MMR / parent-expand
pipeline. Every stage is chunk-addressed. The index is 21,945 chunks:
`doc` 21,149 (96.4%), `agents` 707 (3.2%), `source-md` 89 (0.4%).

Two shape facts drive everything in this design:

1. **The corpus is heavily sectioned.** OpenSpec specs chunk to
   `Requirement → Scenario` granularity — `specs/chat-view/spec.md` yields 44
   chunks matching a single topical query. A topical query therefore lands
   dozens of near-identical chunks from one file, and they sweep the page.
2. **The signal layer is a rounding error.** `agents` chunks are 3.2% of the
   index and average 1,167 chars against `doc`'s 414 — rarer *and* longer, so
   BM25 length normalisation penalises them a second time. They are buried ~30:1
   without a filter.

The existing *Exact-content dedup* requirement collapses by `bodyHash`, which
fires only for byte-identical chunks (the same doc vendored under two roots).
Two different sections of one file have different bodies and never collapse.
`diversity` (lexical MMR over bodies) is the nearest existing lever, but it is
config-gated, off by default, and tuned for topic spread rather than source
identity — Jaccard over two Gherkin scenarios from the same spec is not
reliably high.

Constraints inherited from `markdown-knowledge-base`: no LLM extraction, no
embedding model, deterministic and zero-network. Every decision below is
mechanical.

## Goals / Non-Goals

**Goals:**

- One result page = up to `limit` distinct **sources**, not chunks.
- The AGENTS per-file record layer is reachable without the caller knowing to
  pass `doc_type`.
- Ranking rewards **coverage** of the query, not just per-term BM25 mass.
- A redundancy regression is detectable by `kb eval`, not only by eye.
- Net token cost of a result page goes **down**, not up.

**Non-Goals:**

- **Row-level chunking of `AGENTS.md` tables.** Refuted in the proposal;
  72% of the per-file record is already sidecar-backed and sidecar-backed
  targets retrieve no better than directory-row-backed ones.
- **The code plane.** 74% of files opened after a fall-through are `.ts`/`.tsx`.
  `add-codegraph-code-plane` owns that; this change is the markdown-side
  complement.
- **Query-refinement hints in the tool output.** The original request. Deferred:
  the agent already knows its query failed (it retried 36.5% of the time) and
  reformulates by near-random synonym churn — 63 of 64 real retries were swaps
  that left term count, IDF, and noise-term count statistically unchanged. Hints
  are cheap once PRF terms exist, but they are downstream of four larger causes
  and unmeasured. Revisit after this lands.
- **Embedding / cross-encoder reranking.** The `Reranker` seam already exists and
  stays a no-op.

## Decisions

### D1 — Dedup by `(root, path)`, not by body hash

Group post-BM25 candidates by source and keep the best-scoring representative;
carry the suppressed count forward for display.

*Why not extend the body-hash dedup?* Different semantics. Body-hash dedup
answers "is this the same content in two places" and feeds `akaPaths`
(alternate **locations** of one chunk). Source dedup answers "have I already
shown this file". Both must survive: a file vendored under two roots should
still collapse across roots first, then dedup by source.

*Why not MMR?* It is a similarity heuristic where an exact key is available.
`path` equality is free and total; Jaccard is neither.

*Ordering:* body-hash collapse → source dedup → quota → rerank → parent expand.
Body-hash first so `akaPaths` is computed against the full candidate set.

### D2 — Fetch depth must grow with dedup

Keeping one chunk per source from a 10-row fetch starves the page. Fetch
`limit × 6` (≈60), capped at the existing 4000 ceiling.

Measured: ~13ms → ~25ms on a 21,945-chunk index. This is the single real cost of
the change and is why `performance-optimization` is a named discipline skill.
Budget must be stated as a requirement, not left implicit.

### D3 — Unconditional lane quota, not an intent router

Reserve a share of the page for `doc_type='agents'` on every query.

*Alternative tested and rejected:* route by detected code-intent (camelCase /
snake_case / `.tsx` / `()` in the query) — quota for code queries, plain ranking
otherwise. It **lost** to the unconditional quota on the combined set
(R@10 0.454 vs 0.519). The detector fires on 30% of queries at 45% precision and
30% recall; a coin flip in front of a good policy is worse than the policy.

*Alternative rejected without testing:* instruct the agent to pass
`doc_type=agents`. Already tried in production by the READ-discipline table —
usage is 13% of queries and **drops to 5% on retry**. The lever exists and is
not reached for; moving it into the engine is the correction.

*Ratio:* 6/4 agents/doc interleave measured, untuned. Must be config-exposed and
swept, not frozen at a guess.

### D4 — PRF expansion and coverage rerank ship together or not at all

RM3-style PRF: mine top-k bodies for terms absent from the query with
`df ≤ 10%` of the corpus, rank by `freq × IDF`, take the top 6. Re-retrieve on
`original ∪ expanded`. Rank by IDF-weighted coverage of the **original** terms
(+0.5× the expanded set) with BM25 as tiebreak.

The dependency is measured and non-obvious:

| configuration | P@5 |
|---|---|
| baseline | 0.366 |
| PRF expansion alone | **0.297** — worse |
| coverage rerank alone | 0.416 |
| PRF + coverage rerank | 0.475 |

Expansion adds terms to an OR-query, deepening the dilution the rerank exists to
cure. Coverage must dominate the sort, computed on the original query, or
expansion drifts. `expandQuery(mode:"prf")` already exists as a stub whose
comment says the caller handles the second pass; this writes that caller.

### D5 — Render the leaf heading, not the breadcrumb

47% of the current page is breadcrumb text and 38% of that is verbatim
repetition inside a file group. The distinguishing token (the Scenario name) is
last, after ~100 chars of shared prefix.

Emit `path :: leafHeading` plus `(+N more sections)`. `N` is a free relevance
signal — a per-source match count that says "this file is the topic authority"
in five tokens where the current render spends nine rows saying it.

*Why not truncate the breadcrumb?* Middle-truncation loses the leaf, which is
the only discriminating part. `kb_get(path, section)` still needs the full
breadcrumb, so it stays in the JSON format and in `KbHit`.

### D6 — `limit` means sources (**BREAKING**)

After D1, `limit: 10` returns up to 10 distinct sources. This is the meaning a
caller reading a result page wants, but it is a visible contract change for
`kb_search`, `kb search`, and `kb-plugin`. `store.search()` keeps returning
`KbHit[]`; only the cardinality semantics change. Flagged for
`doubt-driven-review` before it stands.

### D7 — `kb_get` path-only fetch stops lying

`getChunk(root, path)` with no `headingPath` does `ORDER BY rowid LIMIT 1` —
53 of 636 indexed AGENTS files have >1 chunk. Return the whole file's chunks
concatenated, or return the first plus an explicit "N more sections" marker.
Silent arbitrary truncation is not an acceptable third option.

Independent of the ranking work; grouped here because it is the same
chunk-vs-file confusion and the same file.

### D8 — Redundancy is a first-class eval metric

Add `distinctSources@K` (and its inverse, duplicate-slot share) to
`EvalMetrics`. Precision/recall are blind to redundancy **by construction**:
P@1 = 1.0 whether ranks 2–10 are nine other files or nine copies of rank 1.
That blindness let a 55.8% duplicate-slot rate survive ~20 ranking variants and
four significance tests in this investigation; it was found by rendering one
page and reading it.

Freeze both mined golden sets as fixtures: 101 markdown-target and 84
source-target `query → clicked-path` pairs, derived from implicit relevance
feedback in session transcripts (the file the agent opened after the search).

### D9 — `dox lint` `missing` arm covers source files

Today all 47 `missing` findings are `.md`; zero `.ts`/`.tsx` are ever flagged,
while 38% of source files agents opened after a fall-through have no row.
`sourceFiles()` and `parseRowPaths()` already exist in `dox.ts` — the arm is a
set difference over data already collected, not new machinery.

Expect a large one-time finding count. Ship behind a flag or as a distinct arm
so it does not red-wall CI on day one.

## Risks / Trade-offs

- **Fetch depth 10 → 60 is a real latency cost** (~13ms → ~25ms measured) →
  state it as a budget requirement; scale the multiplier with `limit`; keep the
  4000 ceiling.
- **`limit` semantics change breaks callers that assume chunk counts** → audit
  `kb-plugin` and CLI consumers; the JSON format keeps `headingPath` so a caller
  needing sections can still get them.
- **Quota can displace a correct `doc` hit.** 8 losses observed; 7 were
  flooding (fixed by D1), 1 was an alias artifact of the test harness. The
  4 residual losses are all markdown-prose targets displaced by
  topically-correct AGENTS rows → keep the ratio configurable; gate on the
  frozen golden sets.
- **The per-path cap was derived by inspecting the losses** — fitted to the test
  set → the *isolated* dedup result (24W/0L, p<1e-5) was measured independently
  and does not share this flaw, but the +0.043 the cap adds on top needs a
  held-out slice before anyone quotes it.
- **PRF drift.** Mean recovery of the agent's own retry vocabulary is 15% —
  85% of suggested terms are not what was wanted. Harmless when coverage on the
  *original* query dominates the sort; harmful if expansion is allowed to lead.
- **Golden sets are mined by the same agent proposing the change.** Implicit
  clicks are noisy (an opened file is not always the relevant one), and both
  sets over-represent queries that succeeded enough to produce a click →
  the 41.3% fall-through population is under-sampled by construction.
- **Offline metrics ≠ behaviour.** Nothing here proves the fall-through rate
  drops. `ab-context` is the instrument; its current tasks are cued (80–100%
  kb-first vs 23–31% in the field) and should be repointed at the mined real
  queries before it is trusted as a gate.

## Migration Plan

1. Land D8 first — fixtures + redundancy metric, no behaviour change. Establishes
   the baseline the rest is measured against.
2. D1 + D2 + D5 (dedup, fetch depth, render). Zero measured losses; independently
   shippable and independently valuable.
3. D3 (quota), then D4 (PRF + rerank) — in that order, each gated on the frozen
   sets. D4 must not land without D3's page structure or it regresses P@5.
4. D7 and D9 are independent; land any time.
5. **Rollback:** D1–D4 are config-gated ranking behaviour with no index or schema
   change — reverting is a config flip, not a reindex. D5 changes rendered text
   only. D9 is a lint arm.

## Open Questions

- Quota ratio: 6/4 measured but untuned. Fixed, or adaptive to how many `agents`
  candidates actually match?
- Should `(+N more sections)` be clickable — i.e. does `kb_get(path)` become the
  documented way to expand it (D7)?
- Does the `diversity`/MMR option survive source dedup, or is it now redundant?
- Should the READ-discipline substitution table change now that `doc_type` is
  handled engine-side? Field data says the table moved nothing measurably
  (p=0.40), which argues for removing text rather than adding it.
- Is the 4000-row fetch ceiling still right at `limit × 6`?
