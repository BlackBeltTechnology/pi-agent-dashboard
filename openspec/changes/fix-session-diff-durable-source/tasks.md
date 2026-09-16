## 1. Diff-events projection (design D2)

- [x] 1.1 Export the existing tool-args truncation helper from `packages/server/src/persistence/memory-event-store.ts` (export only, no behaviour change); verify `memory-event-store.test.ts` still passes unchanged
- [x] 1.2 Add `projectDiffEvents(sessionId, entries, { maxStringSize })` in new `packages/server/src/session/session-diff-source.ts`: emits only assistant `message_end` (text parts only), `tool_execution_start` (args passed through the exported truncation helper with `maxStringSize`), `tool_execution_end`, in live order (`message_end` before its tool starts); open tool calls are left open (no synthetic end); returns `{ events, lastEntryTs }` with `lastEntryTs` = max ts over all entries; verify by the unit tests folded in group 5
- [x] 1.3 Add `mode?: "diff-events"` + `maxStringSize?: number` to `SessionLoadRequest` in `packages/server/src/session/session-load-worker.ts`; in that mode `loadAndReplay` returns `projectDiffEvents(...)`; verify `session-load-worker.test.ts` covers both modes and the pool passes `mode`, `maxStringSize` and `lastEntryTs` through

## 2. Cache-inside compute + source key + window clamp (design D2, D3, D4)

- [x] 2.1 Change `buildSessionDiffCached` in `packages/server/src/session/session-diff.ts` to take `load: () => Promise<{ events, lastEntryTs? }>` and `opts: { sourceKey, ended }`; key becomes `sessionId:HEAD:djb2(porcelain):sourceKey`; `load` runs inside `cache.run`; `windowEnd = ended ? lastEntryTs : undefined`; update existing call sites/tests; verify existing cache/single-flight tests pass with behaviour unchanged
- [x] 2.2 Add `opts.windowEnd?: number` to `buildSessionDiff` and thread it to `extractBashWindows(events, windowEnd)`; verify existing Bash-window tests pass with the default

## 3. Route event-source resolution (design D1, D3, D5)

- [x] 3.1 Add `ensureLoadWorkerPool(): SessionLoadWorkerPool | null` to `DirectoryService` (creates lazily; a new disposed flag set in `stopPolling` makes it return `null`); pass `loadWorkerPool?: () => SessionLoadWorkerPool | null` and the store's `maxStringSize` config into `registerSessionRoutes` from `server.ts`; verify `registerSessionRoutes` still constructs without them in existing route tests
- [x] 3.2 Add `resolveDiffSource(session, eventStore, { pool?, maxStringSize })` in `session-diff-source.ts`: gate = `mayReadLocalSessionFile({ origin: originOf(session), sessionFile })`; gate passes → `sourceKey = t:<mtime>:<size>` from async `fs.stat` (any error → `t:0:0`) and `load` = pool dispatch in `diff-events` mode (in-process `loadAndReplay` when pool absent/null) falling back to store events when zero entries; gate fails → `sourceKey = s:<count of write/edit/bash tool_execution_start in store>` and `load` = store events; both paths report `lastEntryTs`; verify by the unit tests folded in group 5
- [x] 3.3 Wire `/api/session-diff` in `packages/server/src/routes/session-routes.ts` to `resolveDiffSource` + the new `buildSessionDiffCached` signature, passing `ended = session.status === "ended"`; verify `npm test` is green

## 4. Docs + closeout

- [x] 4.1 Update rows for `session-routes.ts`, `session-diff.ts`, `session-load-worker.ts`, `directory-service.ts`, `memory-event-store.ts`, and the new `session-diff-source.ts` in their nearest `AGENTS.md` with `See change: fix-session-diff-durable-source`; verify `kb dox lint` reports no new stale/missing rows
- [x] 4.2 Delegate a caveman-style note to `DocScribe` for `docs/architecture.md` (session-diff source = transcript for local sessions; store fallback; remote unchanged) and apply the returned rows; verify the section reads correctly
- [ ] 4.3 Run `npm run quality:changed` and `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log; grep -nE 'FAIL|Tests +[0-9]+ (failed|passed)' /tmp/pi-test.log`; verify zero failures, then `review-code` on the diff before commit

## 5. Tests — projection + source resolution (`packages/server/src/__tests__/session-diff-source.test.ts`, new; exemplar `session-load-worker.test.ts` for JSONL fixtures + pool, `session-diff.test.ts` for `makeEvent`/git-repo helpers)

- [x] 5.1 Message attribution + live order: transcript with assistant A ("first") → Edit a.ts, assistant B ("second") → Edit b.ts; run projectDiffEvents then extractFileChanges; a.ts message is "first", b.ts is "second", projected order is message_end(A), start(a), message_end(B), start(b) (test-plan #E4)
- [x] 5.2 Truncation parity at cap+1: Write content of 4001 chars + Edit with 21 edits, projected with maxStringSize 4000 vs the same events ingested into a default store; projected args deep-equal store args; extractFileChanges sets truncated on the Edit on both paths (test-plan #E10)
- [x] 5.3 Truncation cap boundary: Write content of exactly 4000 chars + Edit with exactly 20 edits; projection leaves both intact and sets no truncated flag (test-plan #E11)
- [x] 5.4 Projection event set: transcript with user msg, assistant text-only, assistant Bash toolCall, its toolResult, compaction, model_change; emitted eventTypes ⊆ {message_end, tool_execution_start, tool_execution_end}, exactly 2 message_end, lastEntryTs equals the latest entry's ts even when it is the compaction/model_change entry (test-plan #E12)
- [x] 5.5 Origin gate: session with originDeviceId "remote-1" and a real local sessionFile holding 5 Writes, store holds 1 Edit; resolveDiffSource + route return files.length 1 and a spy on fs.stat/fs.readFile records no call with the sessionFile path (test-plan #E8)
- [x] 5.6 No sessionFile: local session with sessionFile undefined, store holds 1 Write; route returns files.length 1, HTTP 200, no ERR_INVALID_ARG_TYPE (test-plan #E9)
- [x] 5.7 Stat EACCES: fs.stat rejects EACCES for the session file; route returns 200, store-sourced result, sourceKey component is t:0:0 (test-plan #X1)
- [x] 5.8 Malformed last line: transcript with valid header, 2 good Write entries, one truncated mid-append last line; route returns files.length 2, no throw (test-plan #X2)
- [x] 5.9 Worker vs in-process parity: one transcript with 3 Write + 1 Bash; route once with createSessionLoadWorkerPool({useWorker:true}), once with loadWorkerPool absent; the two data payloads deep-equal (test-plan #E16)
- [x] 5.10 Pool disposed: loadWorkerPool returns null; route result equals 5.9's, no rejection (test-plan #E17)

## 6. Tests — route loss modes + ownership (`packages/server/src/__tests__/session-diff-source.test.ts` — real fs+git fixtures; `session-diff.test.ts` mocks `node:fs`, incompatible)

- [x] 6.1 Trim loss mode: store cap 50, session ingests 10 Write/Edit starts then 200 tool_execution_update so every start is trimmed (storeTrim.bySession > 0), transcript holds the same 10 calls; GET /api/session-diff lists the 10 paths sessionOwned and otherChanges excludes them (test-plan #E1)
- [x] 6.2 Restart/evicted loss mode: empty store (no buffer for the session), transcript with 3 Edit + 1 Write; GET /api/session-diff returns files.length 4 with matching changes[0].type and empty otherChanges (test-plan #E2)
- [x] 6.3 Branch walk: transcript whose leaf chain links via parentId to an ancestor Write while a sibling branch carries a different Write; ancestor path in files, sibling path absent (test-plan #E3)
- [x] 6.4 Fallback missing file: sessionFile points at a non-existent path, store holds 2 Write starts; files.length 2 and response keys identical to 6.2's (test-plan #E5)
- [x] 6.5 Fallback header-only: transcript contains only the session header line, store holds 1 Edit start; files.length 1 from the store (test-plan #E6)
- [x] 6.6 Fallback bad header: transcript first line is {"type":"garbage"}, store holds 1 Edit start; files.length 1, HTTP 200 (test-plan #E7)
- [x] 6.7 Open Bash, live: transcript Bash start at T with no toolResult, session status streaming, cwd file mtime T+5s; the file is in files (test-plan #E13)
- [x] 6.8 Open Bash, ended: same transcript with last entry ts T+1s, status ended, cwd file mtime T+60s; file is in otherChanges not files (test-plan #E14)
- [x] 6.9 Clamp slack boundary: ended session with last entry ts T; cwd files at T+999ms and T+1001ms; the first is in files, the second in otherChanges (test-plan #E15)
- [x] 6.10 MAX_FILES on the transcript path: transcript with 201 distinct Write paths; files.length 200 with Write/Edit precedence and path sort as on the store path (test-plan #E18)

## 7. Tests — cache + event loop (`packages/server/src/__tests__/session-diff-source.test.ts` — real fs+git fixtures; exemplar `session-diff-eventloop.test.ts` for the interval-gap sampler)

- [x] 7.1 Cache hit skips the worker: transcript with 50 Writes, two requests within 500ms with nothing changed; second request wall time < 20ms and the worker-pool dispatch spy is called exactly once (test-plan #P3)
- [x] 7.2 Transcript key invalidation on an already-dirty file: Edit on a.ts (dirty in git), request, append a second Edit on a.ts to the transcript with porcelain unchanged; second request within TTL shows 2 change events for a.ts (test-plan #X3)
- [x] 7.3 Store key invalidation: session without sessionFile, store has 1 Write start, request, ingest a second Write start; second request within TTL returns files.length 2 (test-plan #X4)
- [x] 7.4 Streaming does not bust: transcript path, request, ingest 50 message_update events and nothing else; second request within TTL leaves the dispatch spy at one call and returns equal data (test-plan #X5)
- [x] 7.5 Single-flight: worker load stubbed to resolve after 200ms; 5 concurrent requests invoke load exactly once and all 5 responses deep-equal (test-plan #X6)
- [x] 7.6 Pool timeout fallback: pool timeoutMs 50 with a worker that never responds; request still resolves with the correct files via the in-process fallback and does not reject (test-plan #X7)
- [x] 7.7 Event loop under a 20 MB transcript: generated ≥ 20 MB transcript (large assistant texts + 2000 Edit calls) with a real worker pool; while GET /api/session-diff is in flight 10 sequential GET /api/health calls each complete < 100ms; sanity variant with the loader forced in-process records at least one ≥ 100ms so the assertion is proven falsifiable (test-plan #P1)

## 8. Tests — browser (`tests/e2e/`; exemplar `tests/e2e/ended-session-endedat.spec.ts` for the harness restart flow, `tests/e2e/out-of-cwd-session-diffs.spec.ts` for Diff-panel selectors)

- [ ] 8.1 Post-restart Diff panel: spawn a git session, send a prompt that Writes 2 files, wait for both tool events, POST /api/restart and wait for /api/health, open the session's Diff panel; the tree converges to exactly the 2 written paths and selecting one renders a non-empty diff tab (test-plan #F1)

## 9. Manual validation

- [ ] 9.1 Record the worker parse p50/p95 and RSS delta for 5 consecutive uncached GET /api/session-diff on the 20 MB fixture (touch the file between calls) into design.md § Risks; no threshold (test-plan: manual-only)
- [ ] 9.2 After deploying to the local dashboard, open the Diff panel for the four sessions named in proposal.md and confirm each shows its files and agrees with the chat's "N files +A −D" block (test-plan: manual-only)
