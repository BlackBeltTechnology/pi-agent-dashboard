# Measurements — fix-kb-search-retrieval-quality

All numbers produced by scripts committed with this change. Reproduce:

```bash
node packages/kb/eval/mine-golden-sets.mjs          # re-mine the fixtures
npx tsx packages/kb/eval/run-fixtures.ts --fresh    # variant table (indexes this repo)
npx tsx packages/kb/eval/run-fixtures.ts --sweep    # lane-quota sweep
npx tsx packages/kb/eval/measure-render.ts          # render repricing
```

Corpus: this repo, 2,780 files / **31,121 chunks** (the design budgeted ~22,000).
K = 10. Golden sets re-mined 2026-08-13 from 3,312 session transcripts.

## Fixture provenance

The golden sets quoted in `proposal.md` (101 markdown + 84 source pairs) were
never persisted, so they were **re-mined from scratch** by
`packages/kb/eval/mine-golden-sets.mjs`. Independent re-derivation, not a copy.

| | proposal | re-mined |
|---|---|---|
| kb_search calls | 310 | 497 |
| click | 21.9% | 27.2% |
| refine | 36.5% | 33.8% |
| fall-through / abandoned | 41.3% | 21.9%\* |
| markdown-intent pairs | 101 | 108 |
| source-intent pairs | 84 | 104 |

\* Not the same statistic: this miner classifies "no open, no re-search within 8
tool calls", not "ran `rg` afterwards". The click/refine split reproduces
closely, which corroborates the proposal's outcome table.

Source-intent targets are the **`AGENTS.md` record** that documents the opened
file (sidecar if present, else the nearest ancestor naming it) — a source file
can never appear in kb results, since the KB indexes markdown.

## Variant table

| set | variant | R@10 | P@5 | MRR | dupShare | distinctSrc |
|---|---|---|---|---|---|---|
| markdown | baseline (pre-change) | 0.537 | 0.426 | 0.293 | **0.480** | 5.20 |
| markdown | + source dedup (D1/D2) | 0.611 | 0.519 | 0.329 | 0.000 | 9.98 |
| markdown | **+ lane quota 0.5 (D3) — SHIPPED** | **0.630** | 0.509 | 0.324 | 0.000 | 10.00 |
| markdown | + coverage rerank (D4a) | 0.491 | 0.352 | 0.235 | 0.000 | 10.00 |
| markdown | + PRF (D4b) | 0.509 | 0.389 | 0.218 | 0.000 | 10.00 |
| source | baseline (pre-change) | 0.183 | 0.125 | 0.082 | **0.484** | 5.16 |
| source | + source dedup (D1/D2) | 0.317 | 0.212 | 0.110 | 0.000 | 10.00 |
| source | **+ lane quota 0.5 (D3) — SHIPPED** | **0.500** | 0.337 | 0.198 | 0.000 | 10.00 |
| source | + coverage rerank (D4a) | 0.558 | 0.394 | 0.254 | 0.000 | 10.00 |
| source | + PRF (D4b) | 0.558 | 0.481 | 0.281 | 0.000 | 10.00 |

Combined R@10 (n=212, weighted): baseline **0.363** → shipped **0.566** (**+56%**).

**The redundancy claim reproduces exactly.** Duplicate-slot share 0.48 → 0.00 and
distinct sources per page 5.2 → 10.0 on both sets — the proposal's headline
defect (55.8% duplicate slots) is real and fully corrected by D1 alone.

## D4 (coverage rerank + PRF) — NOT ENABLED BY DEFAULT

The proposal projected D4 at +100% R@10. On the re-mined fixtures it is a **net
regression**:

| | markdown R@10 | source R@10 | combined R@10 | source P@5 | source MRR |
|---|---|---|---|---|---|
| D3 (shipped) | **0.630** | 0.500 | **0.566** | 0.337 | 0.198 |
| + coverage rerank | 0.491 | 0.558 | 0.524 | 0.394 | 0.254 |
| + PRF | 0.509 | 0.558 | 0.533 | **0.481** | **0.281** |

D4 is **not broken** — it is a coherent trade. It is clearly *good* for
source-intent (P@5 0.337 → 0.481, MRR 0.198 → 0.281) and clearly *bad* for
markdown-intent (R@10 0.630 → 0.509). The design's stated dependency also
reproduces: PRF without the rerank is a no-op (identical to D3), exactly as
predicted. This corpus is 96.4% `doc` chunks, so the markdown loss outweighs the
source gain and the combined number goes down.

Cost: ~3× latency (57 ms → 173 ms median).

Both are implemented, tested, and config-gated (`ranking.coverageRerank`,
`queryExpansion.mode`), defaulting **off**. A deployment that mostly asks
"where is this symbol" rather than "where is this doc" should turn them on.

Not reproducible against the original numbers: the fixtures they were measured
on no longer exist.

### Correction: the first D4 measurement was run with broken IDF

The initial pass scored D4 lower still (source P@5 0.433, MRR 0.240). Code review
found that `documentFrequencies()` keyed the `chunks_vocab` lookup on the RAW
query token while FTS5 stores porter STEMS — `collapsed` is indexed as `collaps`,
and no prefix range anchored at `collapsed` reaches a key sorting before it. Every
inflected token returned df = 0, i.e. maximum IDF, so coverage weighting was
effectively unweighted and the PRF corpus-frequency ceiling could never reject a
term. Fixed by stemming through SQLite's own tokenizer (`temp.kb_stem`) and
looking up exact stems; the numbers above are post-fix. The **conclusion did not
change**, but the margin narrowed.

## Lane-quota sweep (D3), on the dedup-only base

| share | md R@10 | md MRR | src R@10 | src MRR | combined R@10 |
|---|---|---|---|---|---|
| 0.0 | 0.611 | 0.329 | 0.317 | 0.110 | 0.467 |
| 0.2 | 0.630 | 0.331 | 0.346 | 0.119 | 0.491 |
| 0.3 | 0.630 | 0.332 | 0.404 | 0.133 | 0.519 |
| 0.4 | 0.620 | 0.326 | 0.423 | 0.153 | 0.523 |
| **0.5** | **0.630** | 0.324 | **0.500** | 0.198 | **0.566** |
| 0.6 | 0.602 | 0.319 | 0.538 | 0.205 | 0.571 |
| 0.8 | 0.509 | 0.293 | 0.548 | 0.219 | 0.528 |

Default set to **0.5**: the largest reserved share with **no** markdown-intent
regression (0.630 ≥ 0.611 unquota'd). 0.6 buys +0.005 combined for −0.028
markdown and is inside the design's untuned 6/4 guess, so the guess was
approximately right; 0.5 is the loss-budget-respecting choice.

## Render repricing (D5), 212 real queries

| | before | after |
|---|---|---|
| mean tokens/page | 919.6 | **617.8 (−32.8%)** |
| distinct sources/page | 5.18 | **10.00** |

Strictly cheaper and 1.9× more information-dense — reproduces the proposal's
−29% / 4.5→9.9.

## Latency — BUDGET NOT MET AT p95

Median over 212 real queries, 31,121-chunk index, `expandParent` off:

| config | median | p95 |
|---|---|---|
| baseline | 20.6 ms | 34.8 ms |
| + source dedup (D1/D2) | 25.5 ms | 38.2 ms |
| **+ lane quota 0.5 — SHIPPED** | **53.2 ms** | **84.8 ms** |

The reserved lane is fetched at the SAME depth as the main lane. A shallower
pool was tried and reverted: it saves nothing (the scan, not the `LIMIT`, is the
cost) and it makes `suppressedSections` depend on which lane surfaced a source.

D1/D2 land exactly on the design's prediction (13→25 ms). **D3 is the cost**: its
`agents` lane is a second FTS query, and `doc_type` is an `UNINDEXED` FTS5
column, so it cannot be answered by an index — it scans the full match set. The
reserved lane's pool was already trimmed to `limit × share × 2`; the remaining
cost is the scan itself.

Against the spec's "within 50 ms over ~22,000 chunks": scaling this 31,121-chunk
index by 22/31 gives ≈ **38 ms median (passes)** and ≈ **60 ms p95 (fails)**.

`expandParent` (pre-existing, default ON) costs far more than anything here —
~180 ms median at baseline. Untouched by this change; noted as a follow-up.
