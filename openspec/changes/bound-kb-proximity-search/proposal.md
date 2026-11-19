## Why

Issue: https://github.com/BlackBeltTechnology/pi-agent-dashboard/issues/1075

`kb_search` can freeze the whole pi process for minutes to hours (field report: ~87 min, 15 calls that never returned, heartbeats and Esc dead). The hang is not the reindex wait fixed by `bound-kb-search-freshness` (#895, archived `2026-10-18`); that change bounded only the *freshness* stage (`openspec/changes/archive/2026-10-18-bound-kb-search-freshness/proposal.md` "What Changes"). This one is inside `store.search()` itself, which that change left untouched ("the store's search path is untouched", `openspec/specs/kb-fts5-search-store/spec.md` §Verdict enrichment). Not a regression of #895 — a different, previously unbounded stage.

**Verified at HEAD (`develop`):**

- `proximityDelta()` (`packages/kb/src/sqlite-store.ts:1021`) runs a recursive `walk` (`:1029`) that tries every in-order combination of query-term positions. No `span >= best` pruning; the only early exit `if (best === 1) return` (`:1036`) is reachable only for chains of span 1. Cost = ∏ occurrences per term.
- It runs once per candidate row inside `lane()` (`:646`) whenever `proximityBoost` is on, and that option defaults to `true` (`packages/kb/src/config.ts:188`; threaded by `searchOptsFromConfig`, `packages/kb/src/search-opts.ts:37`, used by the tool at `packages/kb-extension/src/extension.ts:301`).
- `search()` is synchronous (`sqlite-store.ts:559`), so the freshness budget, the tool's `AbortSignal` and the bridge heartbeat `setInterval` cannot preempt it.
- Reproduced here with a verbatim copy of the DFS and a call budget (scratch, not committed): k=5 terms × 50 interleaved repeats = 3.48 M walk calls / 33 ms; k=6×50 and k=8×100 exhaust a 2e7-call budget in ~160–190 ms and are still running. The issue's real chunk (450 KB, ≈3.97e18 combinations) never finishes. Growth is exponential in term count, as claimed.
- The issue's exact-greedy replacement is correct. For a non-decreasing chain the accumulated span telescopes to `p_k − p_0` (`walk` adds `p − start` at each step, `:1035`), and for a fixed `p_0` the earliest admissible successor per term minimises `p_k`. A 20 000-pair randomised differential run (alphabet of 4 tokens, 1–25 token bodies, 2–5 query terms, **duplicate query terms included**) found 0 mismatches against the DFS. The greedy version is 0.15–0.22 ms on the cases above.
- Tokenisation is not the cost: `rawTokens` on an 827 KB body takes ≈2.7 ms. The issue's "cap tokens scanned per body" hardening is therefore unnecessary and would change scores for large chunks.

**Residual risk after the algorithm fix:** the work is still unbounded in wall time (rows × body size). A pool is up to 4000 rows (`sqlite-store.ts:581`, `limit*6` capped at 4000), and any future ranking stage is similarly uncancellable. A deadline on the proximity stage makes the claim "never freezes" hold structurally instead of by argument.

**Stop does not stop it (second field report, 2026-11-19, consumer repo `invoice-bot-dashboard`).** A 7-term `kb_search` (`partner confirm resume invoice partner_ok hold park`) froze a pi session at 100 % CPU for 10+ minutes; Esc/Stop had no effect and the process had to be killed. A CPU profile taken through the inspector showed ~98 % of samples in `extension.ts:270 execute → sqlite-store.ts:559 search → :642 lane → :1021 proximityDelta → walk`. The candidate chunks were single-chunk `AGENTS.md` bodies of 330–437 KB where `invoice` occurs ~1164×, `partner` ~259×, `hold` ~220×. The proximity fix removes *this* cause, but the cancellation contract the kb tools already promise (`openspec/specs/kb-extension-auto-reindex/spec.md` §Pull tools honour cancellation: "return promptly once it is signalled") is structurally unmet for the retrieval stage of every docs call:

- `kb_search` runs `store.search()` synchronously on the session thread (`packages/kb-extension/src/extension.ts:300`); the abort check is only *after* it (`:304`).
- `kb_get` runs `resolveFetch()` synchronously (`extension.ts:396-397`). Every lookup it makes (`getChunk`, `getChunkBySection`, `listRoots`, `packages/kb/src/sqlite-store.ts:799-829`) filters an FTS5 virtual table on its unindexed `root`/`path` columns — a full table scan. On the 357 MB consumer index one such scan takes ~2.2 s cold (`SELECT COUNT(*) FROM chunks WHERE root='.' AND path='README.md'`), and `getChunk` issues two per reading, `pathReadings` several readings (`packages/kb/src/fetch-resolve.ts:37-57`).
- While either runs, the session's event loop is blocked: the `AbortSignal` listener, the bridge heartbeat and the dashboard Stop all queue behind it. An abort *check* cannot help; only moving the synchronous work off the session thread can.

## What Changes

- **Exact linear-ish minimal-window algorithm.** Replace the DFS with a per-start greedy chain using binary search over per-term position lists: `O(|pos[q0]| · k · log n)`. Result is bit-identical to today's `best`, so scores and ordering are unchanged for every query the DFS ever finished.
- **Wall-time guard on the proximity stage.** A per-`search()` proximity time budget (default 250 ms, accumulated across both lanes from time spent inside `proximityDelta` only). Rows are scored in BM25 order; once the budget is spent the remaining rows get Δ = 0 (plain BM25) instead of a boost, and exactly one `console.warn` line is emitted for that search (owner decision: silent ranking degradation plus one log line; no change to the search return contract). The guard is a backstop: it does not fire on the fixtures or on this repo's index (cross-model review measured a full 4000-row pool for 7-term queries at ≈10 ms), but it CAN fire on a repo whose pool holds ~20+ single-chunk bodies of ~450 KB (12.6 ms each); then late rows lose their ≤2-point boost and the log line records it.
- **No position cap, no query-term cap.** Considered and rejected (design D3): the exact algorithm makes them unnecessary, and a cap would alter scores.
- **Docs retrieval for `kb_search` and `kb_get` runs in a worker thread** (design D6). The synchronous store work (`store.search()`; `buildFetchRoots`+`resolveFetch`+`renderFetch`) moves into one lazily started, reused, `unref()`'d `worker_threads` worker per pi process, holding a `SqliteFtsStore.openExisting` handle used for SELECTs only per database (`sqlite-store.ts:132-141`). The session thread awaits the reply and stays responsive. On abort the tool returns the existing cancelled result **immediately** and abandons the worker (`terminate()` fire-and-forget: JS stops at once; a native SQLite statement already running cannot be interrupted by any Node API and finishes in the abandoned thread, verified at planning); other queued requests move to a fresh worker. The worker exits when idle (60 s) and closes a db's connection when its worktree is removed.
- **Hard deadline on the off-thread path** (D8): `KB_QUERY_TIMEOUT_MS` (default 60 s) ends a retrieval like an abort and returns one timeout line (json: line + `[]`), so with the worker available no call can hang a session even when nobody presses Stop.
- **Deviation from "no kb call can hang a session", stated explicitly:** the guarantee holds wherever the off-thread path is available; on the documented fallback hosts below the call behaves as today, bounded only by D1/D2 (accepted non-goal).
- **Fallback** (D7, D9): where the worker cannot load (Node 23.0–23.4, pi with embedded modules, `KB_QUERY_WORKER=0`) the call runs in-process exactly as today, warned once per process — there, Stop still cannot interrupt retrieval (D1/D2 remove the reported freeze). A worker crash is retried once in a fresh worker, never in-process. Worker and in-process paths return identical results (parity test).
- **Tests / gates.** A differential property test (greedy vs reference DFS), a pathological-query performance test, and an unchanged-metrics run of `tsx packages/kb/eval/run-fixtures.ts` as the one-off ranking-regression release gate (a task, not a spec requirement).

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `kb-fts5-search-store` (`openspec/specs/kb-fts5-search-store/spec.md`) — "Proximity boost" gains an exactness scenario; new requirements bound the cost of proximity scoring and make budget expiry observable (one log line).
- `kb-extension-auto-reindex` (`openspec/specs/kb-extension-auto-reindex/spec.md`) — "Pull tools honour cancellation" is extended to the retrieval/fetch stage of `kb_search` and `kb_get`; a new requirement keeps the session thread responsive during that stage and bounds it with a deadline.

## Non-goals

- Making `store.search()` itself async, or cooperative yielding inside ranking (rejected in design D6: cannot interrupt one long SQLite statement or one huge row).
- `kb_neighbors` off-thread: its graph walk is depth-bounded indexed SQL, not reported slow; it keeps the in-process path. `scope: "git"` calls are unchanged (own forge budget).
- The freshness/indexing pass (already cooperative and abortable per `bound-kb-search-freshness`).
- Purging orphan chunks of paths later excluded by `.gitignore`/`DEFAULT_EXCLUDE` (observed: 70 279 of 78 439 chunks in the consumer index), and indexing `root`/`path` for `kb_get` lookups. Separate changes; this one makes them non-freezing, not fast.
- Bounding the other per-row body passes (`coverageRerank`, `prfTerms`, `mmr` tokenise candidate bodies too; `coverageRerank` is opt-in, off by default, `sqlite-store.ts:577`). Measured tokenisation is cheap; they are not the reported cause.
- Making Stop interrupt retrieval where the worker cannot load (runtime matrix, design D7): there the in-process path is today's behaviour, bounded by D1/D2 only.
- Splitting oversized consumer `AGENTS.md` chunks (the issue's "contributing factor" is a consumer-repo DOX size violation).
- Changing the proximity formula `−max(0, 2 − best/20)`.
- Surfacing a degraded-proximity label to the model or changing the `KbHit[]` return contract. Decided 2026-11-03 by owner (design D2): silent degradation plus a single log line.

## Discipline Skills

- `performance-optimization` — a latency bound is the point of the change; measure the pathological repro and the all-chunks cost before/after (task 1.1, 8.1), not argue it.
- `systematic-debugging` — the issue's numbers are a third party's; reproduce first (task 1.1), confirm the equivalence claim independently, then fix.
- `review-code` — before commit (non-trivial change, tests pass).
- `observability-instrumentation` — new worker path: one log line each for worker fallback, deadline expiry and unexpected worker exit; no metrics.
- `node-inspect-debugger` — opaque runtime state (worker lifecycle under jiti, terminate-while-busy); use it if a worker test misbehaves rather than guessing.
- `doubt-driven-review` — the worker entry's TS loading under pi (native strip-types hooks inside a worker) is the one load-bearing assumption; reviewed before tasks fold.
- No security trigger: same local index, read-only handle, no new endpoint, no untrusted input beyond the existing tool params. No schema change. (Apply-loop: new async/worker path → `nodejs-expert` spawn checkpoint.)

## Impact

- `packages/kb/src/sqlite-store.ts` — `proximityDelta()` body, the new internal `minInOrderSpan()` (raw span, exported for the differential test only), and the new `export` of `proximityDelta` (module-private today; tests need to call it directly, same as the already-exported `rawTokens`/`tokenize`), plus a proximity-time budget threaded from `search()` into `lane()` (one new optional `SearchOpts` field for test injection; not mapped from config, so `searchOptsFromConfig`'s key list stays as is) and one `console.warn` on expiry.
- `packages/kb/src/types.ts` — optional `proximityBudgetMs` on `SearchOpts`.
- `packages/kb/src/__tests__/` — new differential + pathological + budget tests.
- `packages/kb/src/sqlite-store.ts.AGENTS.md` — row update.
- `packages/kb-extension/src/extension.ts` — `kb_search` / `kb_get` docs paths call the worker host instead of the store directly; cancelled / timeout results.
- `packages/kb-extension/src/reindex.ts` — `closeKbForCwd` also closes the worker's connection for that db; new `resolveQueryTimeoutMs` beside `resolveFreshnessBudgetMs`.
- New `packages/kb-extension/src/query-worker-host.ts` (session side: lazy worker, request ids, abort → return + abandon, re-dispatch, deadline, crash retry, fallback, kill switch, idle exit), `query-worker.mjs` (committed plain-JS bootstrap: in-thread `module.registerHooks` + `stripTypeScriptTypes`, then imports the TS entry), `query-worker-entry.ts` (opens `SqliteFtsStore.openExisting` per db path, runs search/fetch). AGENTS.md rows for each.
- Session shutdown terminates the worker (alongside the existing store close).
- Build artifact: editing `packages/kb/src` requires `npm run build` in `packages/kb` (`packages/kb/package.json` `build`) and committing the regenerated `packages/kb/engine-fingerprint.json` (`packages/kb/dist` is gitignored and never committed); CI's dist-freshness check otherwise fails (`openspec/specs/kb-retrieval-eval/spec.md` "The built CLI artifact SHALL NOT lag its source").
- Compatibility: no index format or config schema change. Tool output gains two new single-line results (timeout, worker crash) on paths that previously hung; new env knobs `KB_QUERY_TIMEOUT_MS`, `KB_QUERY_WORKER=0`. Scores identical wherever the DFS terminated. Behaviour change only where the DFS effectively never did.
- Migration: none. Rollback: revert the commit. Config workaround meanwhile (`ranking.proximityBoost: false`) remains valid.

Fixes #1075
