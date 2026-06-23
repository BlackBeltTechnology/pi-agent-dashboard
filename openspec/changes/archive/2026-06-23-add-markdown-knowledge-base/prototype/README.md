# KB prototype benchmark (preserved)

Throwaway validation scripts from research (see [`../research.md`](../research.md)
§2.5). Seed for the `kb eval` harness (tasks §4b.7). **Not** the shipped
implementation — a faithful spike of design §3 (structural heading chunker) +
§6c (BM25F ranking) used to measure the concept against the real corpus.

## Run

```bash
# requires bun (bun:sqlite ships FTS5); dataset at repo-root doc-example/
bun bench.ts    # indexing perf + baseline BM25 vs BM25F vs +dedup, normal golden set
bun bench2.ts   # quality features (MMR, proximity) + HARD paraphrase set
                # (BM25F vs +trigram vs +PRF vs +synonym expansion)
```

## Results (2026-06-23, doc-example/ = 691 md → 6,493 chunks)

Indexing ~200 ms cold; ~3 ms/query; deterministic.

| Normal set | P@1 | P@5 | Recall@10 | MRR | nDCG@10 |
|---|---|---|---|---|---|
| Baseline BM25 | 0.55 | 0.85 | 0.95 | 0.65 | 0.72 |
| BM25F | 0.80 | 0.90 | 0.95 | 0.83 | 0.86 |
| BM25F + dedup | 0.80 | 0.95 | 0.95 | 0.85 | 0.87 |

| HARD paraphrase set | Recall@10 | P@1 |
|---|---|---|
| BM25F | 0.11 | 0.00 |
| + trigram | 0.11 | 0.00 |
| + PRF | 0.11 | 0.11 |
| + query/synonym expansion | 1.00 | 0.56 |

Findings, caveats, and decision mapping: [`../research.md`](../research.md) §2.5.

## Notes

- `bun:sqlite` FTS5 used for the spike; shipped impl uses `better-sqlite3`
  (design §9.1) behind the `KbStore` abstraction (design §2.5).
- Golden labels are conservative (single-target) → true precision ≥ measured.
- Local embeddings/cross-encoder did not run on x64-mac (no native ONNX); the
  paraphrase ceiling is shown lexically (research §2.5 platform finding).
