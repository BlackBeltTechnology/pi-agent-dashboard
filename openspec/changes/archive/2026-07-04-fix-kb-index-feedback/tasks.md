# Tasks

## 1. Server — non-blocking reindex route
- [x] 1.1 In `packages/kb-plugin/src/server/__tests__/`, update/add reindex-route tests: fresh `POST /api/kb/reindex` returns `202 { status: "running", jobId }` immediately (no wait for the walk); poll `/stats` until `indexing:false`; assert `chunks > 0`, `jobStatus:"idle"`. → verify: test fails against current blocking route.
- [x] 1.2 Add a failure test: force `reindexAll` to throw; assert the route still responded `202`, then `/stats` reports `indexing:false`, `jobStatus:"error"`, `lastError` set. → verify: test fails or is absent today.
- [x] 1.3 Change the `POST /api/kb/reindex` handler in `kb-routes.ts`: after `registry.start(cwd, …)`, **synchronously** attach `promise.catch((err) => fastify.log.error(…))` (use `fastify.log`, NOT `req.log`), then `reply.code(202); return { status:"running", jobId }`. Remove the now-dead `return await promise` / `try-catch-500` block. Keep the coalesced-running branch unchanged. → verify: 1.1 + 1.2 pass; no unhandled-rejection warning.
- [x] 1.4 Rewrite the existing synchronous-body route tests to poll-until-settled: the `chunks>0` and incremental-`changed:0` assertions must POST→expect `202`→poll `/stats` until `indexing:false`→assert counts (incremental asserts no new chunks via `/stats`, not a body `changed`). → verify: migrated tests green.
- [x] 1.5 Confirm no non-test caller depends on the old `{ changed, chunks }` body (grep `reindex` / `/api/kb/reindex` across server, client, Electron, other plugins). → verify: grep clean; kb-plugin server suite green.

## 2. Client — observe indexing + surface errors without eating the spinner
- [x] 2.1 In `packages/kb-plugin/src/client/__tests__/`, add a `FolderKbSection` spinner test: mock `/reindex`→`202` and `/stats`→`indexing:true` then `populated`; click `Index now`; assert the animated indicator renders during indexing then the chunk count. → verify: fails today (blocking route never shows spinner).
- [x] 2.2 Add a `useKbStats` (or `FolderKbSection`) trigger-error test: mock `/reindex`→reject (`403`); click `Index now`; assert a distinct `reindexError` surfaces the failed/`Retry` affordance; `Retry` re-fires `reindex()` and clears it. → verify: fails today (error discarded).
- [x] 2.3 Add a poll-resilience test: with `indexing:true`, make ONE `/stats` poll reject then recover; assert the row stays on the spinner (no flip to failed) and continues polling to the terminal state. → verify: fails today (`clearPoll()` on first miss).
- [x] 2.4 `useKbStats.ts`: expose `reindexError` distinct from stats-poll errors; make the poll tolerate a bounded run of consecutive transient failures (surface only after N≥3 misses) instead of `clearPoll()`+`setError` on the first; ensure `reindex()` clears `reindexError` before firing and `refetch()` engages the poll on the `202`. → verify: 2.1 + 2.3 pass.
- [x] 2.5 `FolderKbSection.tsx`: render failed + `Retry` when `reindexError != null` OR `stats.jobStatus === "error"`; keep the spinner while `stats.indexing === true` (do NOT gate on a raw `error`). Reuse the existing red `error`/`Retry` styling. → verify: 2.1 + 2.2 pass.

## 5. Non-blocking walk (Layer-1 indexer — scope expansion, found in impl)
- [x] 5.1 `kb-routes` regression test: index a >`YIELD_EVERY` folder (300 files); POST→202; poll `/stats` (yield a macrotask between polls) and assert it is served `200` throughout AND observes `indexing:true` before settling `chunks>0`. → verify: fails against a synchronous indexer.
- [x] 5.2 `packages/kb/src/indexer.ts`: make `indexSource` `async`; commit + `await setImmediate` every `YIELD_EVERY` (100) files (batched transaction). → verify: 5.1 passes; `kb` suite green.
- [x] 5.3 `packages/kb/src/sqlite-store.ts`: add `PRAGMA busy_timeout=5000` so a concurrent reader waits for a batch instead of `SQLITE_BUSY`. → verify: no locked errors under concurrent `/stats` (5.1).
- [x] 5.4 Thread `await` through every `indexSource` caller: `kb-plugin` `reindexAll`, `kb` `runIndex` (cli), `kb-extension` `reindexNow` (+ `extension.ts` `kb_search` freshness `await`, debounce timer `.catch`), `kb/verify.ts`, and the `kb` + `kb-extension` tests. → verify: `tsc --noEmit` clean for kb, kb-extension, kb-plugin; all three suites green.

## 3. Regression + parity
- [x] 3.1 Run the full kb-plugin suite (`npm test` scoped) — server + client green, no swallowed-promise warnings. → verify: exit 0.
- [x] 3.2 `openspec validate fix-kb-index-feedback --strict` passes. → verify: no errors.
- [x] 3.3 Manual: on a cold worktree card, `Index now` shows the spinner during the walk, then the chunk count; a forced 403 (unknown cwd) shows the error + `Retry`. → verify: both observed in the running dashboard.

## 4. Docs + type drift
- [x] 4.1 Update the `POST /api/kb/reindex` response contract everywhere it is documented: `kb-routes.ts` route JSDoc, `packages/kb-plugin/README.md`, and the `KbReindexResult` doc-comment in `shared/kb-plugin-types.ts` (note it is the registry `done` record, not the POST wire shape — now `202 { status:"running", jobId }`). → verify: no doc claims `200 { changed, chunks }` from the POST.
- [x] 4.2 Update per-file `AGENTS.md` rows for `kb-routes.ts`, `useKbStats.ts`, `FolderKbSection.tsx` to note non-blocking `202` + `reindexError`/poll-resilience. Add `See change: fix-kb-index-feedback`. → verify: `kb dox lint` clean.
