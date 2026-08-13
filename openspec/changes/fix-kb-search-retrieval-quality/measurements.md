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
| markdown | + coverage rerank (D4a) | 0.491 | 0.361 | 0.233 | 0.000 | 10.00 |
| markdown | + PRF (D4b) | 0.491 | 0.370 | 0.237 | 0.000 | 9.98 |
| source | baseline (pre-change) | 0.183 | 0.125 | 0.082 | **0.484** | 5.16 |
| source | + source dedup (D1/D2) | 0.317 | 0.212 | 0.110 | 0.000 | 10.00 |
| source | **+ lane quota 0.5 (D3) — SHIPPED** | **0.500** | 0.337 | 0.198 | 0.000 | 10.00 |
| source | + coverage rerank (D4a) | 0.481 | 0.394 | 0.241 | 0.000 | 10.00 |
| source | + PRF (D4b) | 0.558 | 0.433 | 0.240 | 0.000 | 10.00 |

Combined R@10 (n=212, weighted): baseline **0.363** → shipped **0.566** (**+56%**).

**The redundancy claim reproduces exactly.** Duplicate-slot share 0.48 → 0.00 and
distinct sources per page 5.2 → 10.0 on both sets — the proposal's headline
defect (55.8% duplicate slots) is real and fully corrected by D1 alone.

## D4 (coverage rerank + PRF) — NOT ENABLED BY DEFAULT

The proposal projected D4 at +100% R@10. On the re-mined fixtures it is a **net
regression**:

- markdown-intent R@10 **0.630 → 0.491 (−22%)**
- source-intent R@10 0.500 → 0.558 (+12%)
- combined **0.566 → 0.524 (−7%)**
- latency ~4× (53 ms → 222 ms median)

The dependency the design predicted *is* visible in the source set (PRF alone
adds nothing without the rerank; together they lift P@5 0.337 → 0.433), so D4 is
not broken — it trades markdown recall for source precision, and this corpus
does not want that trade. Both are implemented, tested, and config-gated
(`ranking.coverageRerank`, `queryExpansion.mode`), defaulting **off**.

Not reproducible against the original numbers: the fixtures they were measured
on no longer exist.

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

D1/D2 land exactly on the design's prediction (13→25 ms). **D3 is the cost**: its
`agents` lane is a second FTS query, and `doc_type` is an `UNINDEXED` FTS5
column, so it cannot be answered by an index — it scans the full match set. The
reserved lane's pool was already trimmed to `limit × share × 2`; the remaining
cost is the scan itself.

Against the spec's "within 50 ms over ~22,000 chunks": scaling this 31,121-chunk
index by 22/31 gives ≈ **38 ms median (passes)** and ≈ **60 ms p95 (fails)**.

`expandParent` (pre-existing, default ON) costs far more than anything here —
~180 ms median at baseline. Untouched by this change; noted as a follow-up.
