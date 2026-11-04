## Why

Issue: https://github.com/BlackBeltTechnology/pi-agent-dashboard/issues/1075

`kb_search` can freeze the whole pi process for minutes to hours (field report: ~87 min, 15 calls that never returned, heartbeats and Esc dead). The hang is not the reindex wait fixed by `bound-kb-search-freshness` (#895, archived `2026-10-18`); that change bounded only the *freshness* stage (`openspec/changes/archive/2026-10-18-bound-kb-search-freshness/proposal.md` "What Changes"). This one is inside `store.search()` itself, which that change left untouched ("the store's search path is untouched", `openspec/specs/kb-fts5-search-store/spec.md` §Verdict enrichment). Not a regression of #895 — a different, previously unbounded stage.

**Verified at HEAD (`develop`):**

- `proximityDelta()` (`packages/kb/src/sqlite-store.ts:1000`) runs a recursive `walk` (`:1008`) that tries every in-order combination of query-term positions. No `span >= best` pruning; the only early exit `if (best === 1) return` (`:1015`) is reachable only for chains of span 1. Cost = ∏ occurrences per term.
- It runs once per candidate row inside `lane()` (`:646`) whenever `proximityBoost` is on, and that option defaults to `true` (`packages/kb/src/config.ts:188`; threaded by `searchOptsFromConfig`, `packages/kb/src/search-opts.ts:37`, used by the tool at `packages/kb-extension/src/extension.ts:301`).
- `search()` is synchronous (`sqlite-store.ts:559`), so the freshness budget, the tool's `AbortSignal` and the bridge heartbeat `setInterval` cannot preempt it.
- Reproduced here with a verbatim copy of the DFS and a call budget (scratch, not committed): k=5 terms × 50 interleaved repeats = 3.48 M walk calls / 33 ms; k=6×50 and k=8×100 exhaust a 2e7-call budget in ~160–190 ms and are still running. The issue's real chunk (450 KB, ≈3.97e18 combinations) never finishes. Growth is exponential in term count, as claimed.
- The issue's exact-greedy replacement is correct. For a non-decreasing chain the accumulated span telescopes to `p_k − p_0` (`walk` adds `p − start` at each step, `:1011`), and for a fixed `p_0` the earliest admissible successor per term minimises `p_k`. A 20 000-pair randomised differential run (alphabet of 4 tokens, 1–25 token bodies, 2–5 query terms, **duplicate query terms included**) found 0 mismatches against the DFS. The greedy version is 0.15–0.22 ms on the cases above.
- Tokenisation is not the cost: `rawTokens` on an 827 KB body takes ≈2.7 ms. The issue's "cap tokens scanned per body" hardening is therefore unnecessary and would change scores for large chunks.

**Residual risk after the algorithm fix:** the work is still unbounded in wall time (rows × body size). A pool is up to 4000 rows (`sqlite-store.ts:575`, `limit*6` capped at 4000), and any future ranking stage is similarly uncancellable. A deadline on the proximity stage makes the claim "never freezes" hold structurally instead of by argument.

## What Changes

- **Exact linear-ish minimal-window algorithm.** Replace the DFS with a per-start greedy chain using binary search over per-term position lists: `O(|pos[q0]| · k · log n)`. Result is bit-identical to today's `best`, so scores and ordering are unchanged for every query the DFS ever finished.
- **Wall-time guard on the proximity stage.** A per-`search()` proximity time budget (default 250 ms, accumulated across both lanes from time spent inside `proximityDelta` only). Rows are scored in BM25 order; once the budget is spent the remaining rows get Δ = 0 (plain BM25) instead of a boost, and exactly one `console.warn` line is emitted for that search (owner decision: silent ranking degradation plus one log line; no change to the search return contract). The guard is a backstop; on all measured inputs it does not fire.
- **No position cap, no query-term cap.** Considered and rejected (design D3): the exact algorithm makes them unnecessary, and a cap would alter scores.
- **Tests / gates.** A differential property test (greedy vs reference DFS), a pathological-query performance test, and an unchanged-metrics run of `tsx packages/kb/eval/run-fixtures.ts` as the one-off ranking-regression release gate (a task, not a spec requirement).

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `kb-fts5-search-store` (`openspec/specs/kb-fts5-search-store/spec.md`) — "Proximity boost" gains an exactness scenario; new requirements bound the cost of proximity scoring and make budget expiry observable (one log line).

## Non-goals

- Making `store.search()` async/cancellable or moving ranking to a worker thread. The guard bounds one stage; the wider structural bound is a separate proposal.
- Bounding the other per-row body passes (`coverageRerank`, `prfTerms`, `mmr` tokenise candidate bodies too; `coverageRerank` is opt-in, off by default, `sqlite-store.ts:577`). Measured tokenisation is cheap; they are not the reported cause.
- Splitting oversized consumer `AGENTS.md` chunks (the issue's "contributing factor" is a consumer-repo DOX size violation).
- Changing the proximity formula `−max(0, 2 − best/20)`.
- Surfacing a degraded-proximity label to the model or changing the `KbHit[]` return contract. Decided 2026-11-03 by owner (design D2): silent degradation plus a single log line.

## Discipline Skills

- `performance-optimization` — a latency bound is the point of the change; measure the pathological repro and the all-chunks cost before/after (task 1.1, 5.1), not argue it.
- `systematic-debugging` — the issue's numbers are a third party's; reproduce first (task 1.1), confirm the equivalence claim independently, then fix.
- `review-code` — before commit (non-trivial change, tests pass).
- No security / observability / irreversible-step triggers: pure in-process ranking over already-indexed local text, no new endpoint or external call, no schema change.

## Impact

- `packages/kb/src/sqlite-store.ts` — `proximityDelta()` body and its new `export` (module-private today; tests need to call it directly, same as the already-exported `rawTokens`/`tokenize`), plus a proximity-time budget threaded from `search()` into `lane()` (one new optional `SearchOpts` field for test injection; not mapped from config, so `searchOptsFromConfig`'s key list stays as is) and one `console.warn` on expiry.
- `packages/kb/src/types.ts` — optional `proximityBudgetMs` on `SearchOpts`.
- `packages/kb/src/__tests__/` — new differential + pathological + budget tests.
- `packages/kb/src/sqlite-store.ts.AGENTS.md` — row update.
- Build artifact: editing `packages/kb/src` requires `npm run build` in `packages/kb` (`packages/kb/package.json` `build`) and committing the regenerated `packages/kb/engine-fingerprint.json`; CI's dist-freshness check otherwise fails (`openspec/specs/kb-retrieval-eval/spec.md` "The built CLI artifact SHALL NOT lag its source").
- Compatibility: no index format, config schema, or tool output change. Scores identical wherever the DFS terminated. Behaviour change only where the DFS effectively never did.
- Migration: none. Rollback: revert the commit. Config workaround meanwhile (`ranking.proximityBoost: false`) remains valid.

Fixes #1075
