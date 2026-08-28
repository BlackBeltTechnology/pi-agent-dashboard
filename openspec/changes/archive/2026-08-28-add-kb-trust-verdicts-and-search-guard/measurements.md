# Measurements — add-kb-trust-verdicts-and-search-guard

All numbers from this worktree (macOS, Apple Silicon, node 24.15), measured with
`packages/kb/eval/measure-search-latency.ts` (committed) against the bundled
fixture index: a real index of this worktree, 25,904 chunks, built with
run-fixtures-matching options (config defaults + `**/.worktrees/**`,
`**/dist/**` excludes).

## 1.1 — Pre-change search baseline (task 1.1)

| config | median | p95 |
|---|---|---|
| shipped defaults (`expandParent: true`, laneQuota 0.5) | **132.46 ms** | 225.46 ms |
| same, `expandParent: false` | **53.3 ms** | 82.9 ms |

n=212 golden queries, 1 warmup query. Attribution: with `expandParent: false`
this run reproduces the archived budget measurement (53.2 ms median over a
31,121-chunk index, `specs/kb-fts5-search-store`) almost exactly. The gap is
the parent-expansion fetch: `chunks` is an FTS5 **virtual table**, so
`getChunkById` (one call per hit with parent) is a full scan of every row body
— no b-tree index is possible on an FTS5 table. **Pre-existing store cost;
`sqlite-store.ts` is deliberately untouched by this change.** Recorded so the
enrichment budget below is never blamed for it.

## 1.2 — `kb dox lint` population (task 1.2)

Snapshot at change start (this worktree, defaults, no `--source-rows`):

| kind | count |
|---|---|
| stale | **0** |
| orphan | 1 |
| broken-ref | 2 |
| missing | 27 |
| missing-companion | 1 |
| over-threshold | 3 |
| total | 34 |

The population verdicts label at query time: 0 acked rows are stale at
snapshot; the dominant honest state is UNVERIFIED (most rows have no acked
hash — the sidecar is sparse by design, D12).

## 3.5 / P1 — Additive verdict-enrichment latency (task 3.5)

Same run, same 212 queries, `--enrich`: every returned page enriched with
default options (verdicts on, coverage off; bodies read from disk; ≤8 subjects
per agents hit; hashing capped at 1 MiB; ONE batched rename scan per
enrichment only when a subject is absent).

| metric | value | target |
|---|---|---|
| enrichment median | **0.78 ms** | ≤ 15 ms advisory |
| enrichment p95 | 1.55 ms | — |
| enriched hits | 2112 | — |
| **delta vs 1.1 search median** | **+0.78 ms** | additive, store untouched |

19x headroom under the advisory target. **Deliberately NO CI assertion** —
advisory by decision at planning (the shipped 50 ms search budget is the
store's gate and the store is untouched).

### Method note (the FTS5-scan trap)

The first draft of the enricher fetched section bodies via
`store.getChunkById`. Measured on a mis-built fixture index (65,842 chunks —
built without config excludes), that showed ~58 ms per body fetch and ~274 ms
median enrichment. Root cause: FTS5 virtual table = full scan per lookup, and
the mis-built corpus doubled the scan. Fix: bodies now default from DISK
(`verdict.ts` `bodyFromDisk` re-chunks the source markdown and matches the
breadcrumb) — cheaper by orders of magnitude, and semantically better: the
question is what the row says NOW, and disk is fresher than a debounced index.

## 3.7 — Content-coverage calibration (task 3.7)

Subject-coverage score (share of query terms present in the subject files,
256 KB cap, binary skip) measured over both bundled golden sets: for every
hit, is coverage ≥ t predictive of the hit being the gold answer?

| population | n | mean | median |
|---|---|---|---|
| gold hits | 4 | 0.752 | 0.857 |
| non-gold hits | 260 | 0.691 | 0.700 |

No threshold separates the populations (t=0.4: 100% of gold ≥ t but also 90%
of non-gold; t=0.8: 50% vs 40%). The signal also rarely applies — only 4 gold
hits had resolvable subjects with computable coverage.

**Verdict: keep coverage default-OFF.** The numbers do not justify its latency
or its token cost, mirroring the engine-side `coverageRerank` precedent
(`fix-kb-search-retrieval-quality`: net regression on the same fixtures).
