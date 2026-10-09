# Measurements — fix-kb-unicode-tokenizer

Gate row: `+ lane quota (D3)` (matches shipped config: coverage rerank + PRF default off).

## Before (develop cdd7d9ab5)

Commands: `NODE_OPTIONS=--experimental-sqlite npx tsx packages/kb/eval/run-fixtures.ts --fresh --json`, `... measure-search-latency.ts --json`.

Index: 3819 files, 42811 chunks

| set | variant | n | P@1 | MRR | R@10 | dupShare |
|---|---|---|---|---|---|---|
| markdown-intent | baseline (pre-change) | 73 | 0.123 | 0.204 | 0.452 | 0.499 |
| markdown-intent | + source dedup (D1/D2) | 73 | 0.123 | 0.246 | 0.534 | 0 |
| markdown-intent | + lane quota (D3) | 73 | 0.123 | 0.23 | 0.534 | 0 |
| markdown-intent | + coverage rerank (D4a) | 73 | 0.137 | 0.23 | 0.493 | 0 |
| markdown-intent | + PRF (D4b) = shipped default | 73 | 0.11 | 0.208 | 0.507 | 0 |
| markdown-intent | PRF WITHOUT coverage rerank (must be worse) | 73 | 0.123 | 0.23 | 0.534 | 0 |
| source-intent | baseline (pre-change) | 104 | 0.038 | 0.06 | 0.135 | 0.495 |
| source-intent | + source dedup (D1/D2) | 104 | 0.038 | 0.078 | 0.212 | 0 |
| source-intent | + lane quota (D3) | 104 | 0.038 | 0.16 | 0.404 | 0 |
| source-intent | + coverage rerank (D4a) | 104 | 0.077 | 0.192 | 0.442 | 0 |
| source-intent | + PRF (D4b) = shipped default | 104 | 0.135 | 0.237 | 0.471 | 0 |
| source-intent | PRF WITHOUT coverage rerank (must be worse) | 104 | 0.038 | 0.16 | 0.404 | 0 |

Search latency (212 queries, reused cached fixture index (42811 chunks)): median 89.33 ms, p95 135.56 ms


## After (fix applied)

Index: 3820 files, 42813 chunks

| set | variant | n | P@1 | MRR | R@10 | dupShare |
|---|---|---|---|---|---|---|
| markdown-intent | baseline (pre-change) | 73 | 0.123 | 0.204 | 0.452 | 0.499 |
| markdown-intent | + source dedup (D1/D2) | 73 | 0.123 | 0.246 | 0.534 | 0 |
| markdown-intent | + lane quota (D3) | 73 | 0.123 | 0.23 | 0.534 | 0 |
| markdown-intent | + coverage rerank (D4a) | 73 | 0.137 | 0.23 | 0.493 | 0 |
| markdown-intent | + PRF (D4b) = shipped default | 73 | 0.11 | 0.208 | 0.507 | 0 |
| markdown-intent | PRF WITHOUT coverage rerank (must be worse) | 73 | 0.123 | 0.23 | 0.534 | 0 |
| source-intent | baseline (pre-change) | 104 | 0.038 | 0.06 | 0.135 | 0.495 |
| source-intent | + source dedup (D1/D2) | 104 | 0.038 | 0.078 | 0.212 | 0 |
| source-intent | + lane quota (D3) | 104 | 0.038 | 0.16 | 0.404 | 0 |
| source-intent | + coverage rerank (D4a) | 104 | 0.077 | 0.192 | 0.442 | 0 |
| source-intent | + PRF (D4b) = shipped default | 104 | 0.135 | 0.237 | 0.471 | 0 |
| source-intent | PRF WITHOUT coverage rerank (must be worse) | 104 | 0.038 | 0.16 | 0.404 | 0 |

Search latency (212 queries, reused cached fixture index (42813 chunks)): median 96.27 ms, p95 128.47 ms

## Gates

- **P3 ranking (task 4.2): PASS.** Every row, every golden set, is identical to the baseline (P@1, MRR, R@10, dupShare unchanged). The fixture corpus is English, so no row moved; the accented-query gain is proven by `packages/kb/src/__tests__/unicode-tokenizer.test.ts`. Index +1 file / +2 chunks = this change's new test file and `measurements.md`.
- **P2 tail latency (task 4.4): PASS.** Single run: p95 135.56 → 128.47 ms. Repeat runs below (3 per side, alternating, cached index, "before" = `HEAD` `sqlite-store.ts`): median-of-runs p95 152.7 → 157.21 ms = ×1.03 ≤ ×1.10.
- **P1 median budget (task 4.3): budget not met on this machine, on either side, so the cause is the environment and not this change.** The develop baseline is already 87–113 ms median. The fixture index is the whole repo at 42.8k chunks, about 2× the ~22k the test plan assumed, and the host was under load: runs drift upward over time on both sides. Delta attributable to the change: median-of-runs 108.1 → 109.95 ms (+1.7%), within run-to-run noise (±13 ms on the same side).

### Repeat latency runs (median ms, p95 ms)

| run | before | after |
|---|---|---|
| 1 | 87.31, 124.73 | 94.38, 128.80 |
| 2 | 108.10, 154.10 | 109.95, 157.21 |
| 3 | 113.35, 152.70 | 129.28, 326.15 |
| median of runs | 108.10, 152.70 | 109.95, 157.21 |
- **User decision:** P1 accepted as environmental (Δ +1.7%); task 4.3 marked done.
