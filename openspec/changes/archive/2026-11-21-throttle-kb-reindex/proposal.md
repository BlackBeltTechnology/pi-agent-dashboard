## Why

Issue [#1131](https://github.com/BlackBeltTechnology/pi-agent-dashboard/issues/1131): on large KBs (~50k chunks, 150–250 MB `index.db`) a reindex pins the dashboard server's main thread for tens of seconds (`cwd-admission` deadlines, `heartbeat timeout`, `watchdog FIRE`). Three verified causes this change fixes:

1. **Trigger — engine fingerprint is far too coarse.** `computeSrcHash` hashes every non-test `.ts` under `packages/kb/src/` (`packages/kb/bin/lib/engine-fingerprint.mjs:51-57`); `runningEngine()` returns that `srcHash` (`packages/kb/src/index-gate.ts:21-33`); `sourceGateIsStale()` compares it to the per-source `engine:<root>` record (`index-gate.ts:42-45`); stale ⇒ `indexSource(..., { force: true })` re-chunks every file (`packages/kb-plugin/src/server/kb-routes.ts:271`). So an edit to `cli.ts`, `render.ts`, `fetch-resolve.ts`, or the search half of `sqlite-store.ts` (e.g. active change `bound-kb-proximity-search`) forces a machine-wide rebuild. Only 5 files feed row production: `indexer.ts` imports `adoc-chunker`, `chunker`, `frontmatter`, `gitignore` (`indexer.ts:7-10`).
2. **Stall length — batch bound is a count, not time.** `YIELD_EVERY = 100` files per commit+yield (`packages/kb/src/indexer.ts:68,192`); the walk and gitignore pre-scan already have a 50 ms cap (`WALK_YIELD_MAX_MS`, `indexer.ts:74-83`) but the per-file loop has none, and the server runs it in-process (`kb-routes.ts:264-285` `indexInPlace`). 100 large files + FTS/graph writes can block for seconds.
3. **Where it runs — main thread.** Every reindex entry point funnels through `reindexAll` (`packages/kb-plugin/src/server/kb-routes.ts:302`; callers `kb-routes.ts:519,700`, `index.ts:72`), which awaits `indexSource` on the server's own event loop (`indexInPlace`, `kb-routes.ts:264`), however small the batches. Even a well-bounded batch loop still competes with HTTP/WS/heartbeat work and SQLite calls are synchronous.

## What Changes

- Add `rowsHash` to `engine-fingerprint.json`: a hash of the row-producing allowlist (`indexer.ts`, `chunker.ts`, `adoc-chunker.ts`, `frontmatter.ts`, `gitignore.ts`). `runningEngine()` reads `rowsHash` instead of `srcHash`. `srcHash`/`tsconfigHash`/`distHash` stay (CI freshness gate, bin shim unchanged).
- Add a guard test: the static import closure of `indexer.ts` must be ⊆ allowlist ∪ an explicit non-row list (`types.ts`; `sqlite-store.ts` governed by `SCHEMA_VERSION`; `config.ts` governed by `indexOptionsHash`), so a new row-producing import cannot silently skip the fingerprint. A second golden test pins `{SCHEMA_VERSION, sha256(DDL)}` of `sqlite-store.ts` so a DDL/tokenizer edit without a `SCHEMA_VERSION` bump fails CI.
- Add a time budget to the per-file batch loop: commit + yield when `YIELD_EVERY` files **or** `INDEX_BATCH_MAX_MS` (50 ms) elapsed since the last yield, whichever first.
- **Run the server-side reindex in a kb-specific `worker_threads` worker** (confirmed (owner, 2026-11-20): #1131 fix 2; NOT the generic #417 pool, which stays open and untouched). The worker owns its own `node:sqlite` handle (verified to work inside `worker_threads`); the main thread only resolves sources, schedules the worker, receives progress/logs and can cancel. One worker per KB (cwd) at a time (existing registry coalescing). `KbJobRegistry` gains cancel + progress; `/api/kb/stats` gains optional transient `progress`; new `POST /api/kb/reindex/cancel` (listed in `route-tiers.ts` as `operate`). Kill-switch `PI_DASHBOARD_KB_REINDEX_WORKER=0` restores the in-process path (also the path for kb-extension/CLI callers, unchanged).
- Add an additive `signal?: AbortSignal` and `onProgress?` to `IndexOptions` (indexer batch boundary) so the worker can cancel and report cleanly.
- **Measure first** (tasks 1.x): baseline event-loop lag + wall time of a forced pass on a synthetic ~50k-chunk corpus; re-measure after (in-process with the time budget, and worker mode); record in `design.md`. **Target: no main-thread event-loop lag > 200 ms during a full reindex of a ~50k-chunk KB.**

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `kb-indexing-pipeline`: ADDED "Engine fingerprint covers only row-producing sources" (defines "the kb engine fingerprint" as `rowsHash` for the existing seed/engine-gate scenarios too); ADDED "Batch commits are time-bounded"; ADDED "Index passes are cancellable and report progress".
- `kb-plugin-index-jobs`: ADDED "Reindex runs in a kb worker thread", "Running reindex can be cancelled", "Reindex progress and job telemetry"; MODIFIED "Per-source status endpoint" (carves the transient `progress` field out of the "no per-source data / stats shape unchanged" rule).
- `kb-retrieval-eval`: MODIFIED "Stale dist is rejected" requirement scenario set — a committed `engine-fingerprint.json` lacking `rowsHash` also fails the freshness check.

## Non-goals

Deliberately deferred (see `design.md`, `/tmp/issue-batch/throttle-kb-reindex-DECISIONS.md`):
- **Extracting/consuming the generic worker pool (#417)**: stays open and untouched; the kb worker here is deliberately self-contained (one purpose-built worker, own SQLite handle) and can migrate onto the pool later.
- Moving the in-process callers (kb-extension auto-reindex inside pi sessions, `kb` CLI) to a worker; they keep the time-bounded in-process loop.
- Server `busy_timeout` + async `SQLITE_BUSY` retry (fix 3), one-writer lease (fix 5), incremental `reconcileChunkMap` (fix 6; its own comment measures 25 ms on 40k chunks, `sqlite-store.ts:337`), `counts()` caching (fix 7), guard-predicate `COUNT(*)` (fix 8, `kb-extension`). Each is a follow-up if measurement shows it matters.
- Changing the post-walk single-statement sweeps (`sweepPlaceholders`, deletion sweep).

## Relationship

- `bound-kb-proximity-search` (**shipped**, #1177, `883d8af23`; archived `2026-11-20-bound-kb-proximity-search`): no ordering constraint remains. Its `sqlite-store.ts` search edits and regenerated `engine-fingerprint.json` are already in the tree, so this change builds on them (task 5.1 regenerates the fingerprint over that baseline). It also shipped a pi-side kb **query worker** (`packages/kb-extension/src/query-worker-host.ts`, `query-worker.mjs`, `query-worker-entry.ts`, `__tests__/query-worker-loader.test.ts`) — the direct precedent for the server-side reindex worker here (see design D3). It covers retrieval in kb-extension only; no file overlap with our indexing worker.
- `add-kb-semantic-annotation-plane` (active): edits `indexer.ts` — correctly a row-producing change, will bump `rowsHash` once. `add-omni-embedding-retrieval` (active): touches fingerprint test expectations (`engine-fingerprint.test.ts`, task 3.3); rebase over the `rowsHash` field. No fold: both are independent and larger.
- Archived: `add-kb-worktree-seed` (D6, engine record/seed gate — semantics preserved), `fix-kb-index-integrity` (gate), `bound-kb-search-freshness` (walk yield). #1131's trigger #1123 (`fix-kb-get-roots-and-guard`) is archived; not a regression to revert.

## Discipline Skills

- `performance-optimization` — latency/large-data path: tasks 1.x measure before/after with `withEventLoopLag` (≤ 200 ms target).
- `observability-instrumentation` — new background worker + cancel path: lifecycle logs, progress in `/stats`, per-job event-loop lag/throughput line.
- `systematic-debugging` / `node-inspect-debugger` — only if the worker loader-inheritance spike (task 4.1) shows opaque worker/loader behaviour.
- `security-hardening` — not triggered: the worker only receives already-admitted, already-resolved source dirs; the new cancel route reuses `admitKbCwd`.
- `review-code` — non-trivial change, run before commit.
- `doubt-driven-review` — the fingerprint allowlist is an irreversible-ish correctness choice (a missed row-producing file ⇒ silently stale rows); review the allowlist + guard test before it stands.

## Impact

- Files: `packages/kb/bin/lib/engine-fingerprint.mjs` (+ `scripts/lib/kb-engine-fingerprint.mjs` re-export, `scripts/check-kb-dist-fresh.mjs` if it must require `rowsHash`), `packages/kb/engine-fingerprint.json` (regenerated), `packages/kb/src/index-gate.ts`, `packages/kb/src/indexer.ts` (+`signal`/`onProgress`), tests under `packages/kb/src/__tests__/`, `packages/kb/dist` (rebuild per `packages/kb/package.json`; gitignored). Plugin: `packages/kb-plugin/src/server/{kb-routes.ts,job-registry.ts,index.ts}` + new `reindex-core.ts`, `reindex-worker.mjs`, `reindex-runner.ts`, `packages/kb-plugin/src/shared/kb-plugin-types.ts` (stats `progress`), `packages/shared/src/route-tiers.ts` (cancel route), `packages/electron/scripts/assert-bundled-plugins-complete.mjs` (worker entry ships). `packages/electron/resources/server/resources/plugins/kb-plugin/` is a generated stale copy — not edited.
- **Migration:** existing DBs record `engine:<root> = old srcHash`; the first pass after upgrade forces each source once (unavoidable one-time rebuild, now time-bounded), then stable across non-row edits.
- **Compat:** `engine-fingerprint.json` keeps `srcHash`; older kb code reading it keeps working. **Mixed versions:** a pi session still running the old kb-extension compares its `srcHash` to the `engine:<root>` record, which this server now stamps with `rowsHash` ⇒ each old session forces one full rebuild and re-stamps `srcHash`, which the new server then sees as stale and forces again — ping-pong until every session has `npm run reload`ed (same class as today's any-src-edit storm). Documented, not engineered around; verify (task 5.3) only after reloading all sessions. New code with a JSON lacking `rowsHash` ⇒ `runningEngine()` returns `null` (no engine gating — same as the existing unreadable-file path).
- **Rollback:** revert (or set `PI_DASHBOARD_KB_REINDEX_WORKER=0` for the worker half alone, no redeploy of data); old code re-reads `srcHash`, mismatches the recorded `rowsHash` once ⇒ one forced pass; no data loss, no schema change. The DB format is unchanged by the worker: same WAL file, same `node:sqlite` driver, so worker/in-process runs interoperate.
- **Concurrency/compat:** WAL lets main-thread readers (search, `/stats`) run while the worker writes; only one writer per DB (the worker). Cancel mid-run keeps committed batches (idempotent re-run); first-index temp builds are discarded (graceful abort) or unlinked by the runner (terminate/crash — a worker shares the server's PID, so `sweepOrphanTemps` cannot reclaim it).
- Build/verify: kb change ⇒ `npm run build` in `packages/kb` (`dist/` is gitignored: rebuild locally, commit only `engine-fingerprint.json`); server uses it via `npx tsx .pi/skills/implement/scripts/restart-server.ts`; kb-extension sessions via `npm run reload`.
