## 1. Cache layer — server-scoped entries

- [x] 1.1 Add `serverKey: string` to `ReplayCacheEntry` and bump `REPLAY_CACHE_SCHEMA_VERSION` to 3 in `packages/client/src/lib/replay/replay-cache.ts`.
- [x] 1.2 Widen `get(sessionId, serverKey)` and `put(sessionId, value, serverKey)`. In `get`, run the existing `schemaVersion` check FIRST, then the key check; a key mismatch returns `null` and must NOT delete the entry and must NOT reach `touch()`.
- [x] 1.3 Leave `delete(sessionId)` unkeyed and `Promise<void>` — the schema purge, the over-cap branch in `put`, the poisoned-entry catch in `rehydrate-session.ts`, and the `session_state_reset` drop all delete without a current-server notion.
- [x] 1.4 Add the shared key-derivation helper: `` `${host}:${port}` `` from a `wsUrl`, substituting the protocol default port (`ws:`→80, `wss:`→443), scheme excluded. Single source used by both mount and switch.

## 2. Persister — key getter + buffer reset

- [x] 2.1 Add a `getServerKey: () => string` parameter to `createReplayPersister` and call it inside `flush()` (flush time, not construction time) when writing via `cache.put`.
- [x] 2.2 Add `resetBuffers(): void` — clear every pending timer and empty `buffers`, `descended`, `contaminated`. Synchronous, no IndexedDB, cannot fail.

## 3. Rehydrate + App wiring

- [x] 3.1 Widen `rehydrateSession(sessionId, cache, serverKey)` and pass the key through to `cache.get`.
- [x] 3.2 Add `serverKeyRef` to `App.tsx`, set synchronously from the derivation helper at initial mount and inside the switch commit wherever `setWsUrl` is called; pass a getter into `createReplayPersister` and the current value into `rehydrateSession`.
- [x] 3.3 Add `replayPersisterRef.current.resetBuffers()` to `clearInMemoryState`, beside `maxSeqMapRef.current.clear()` and `rehydratedRef.current.clear()`. Do NOT widen `ServerSwitchDeps` or add an `await` — `performServerSwitch` is untouched by this change.

## 4. Refresh Chat — one durable-first callback

- [x] 4.1 Extract the blocks duplicated at `App.tsx:1559` (`mobileActions.onRefresh`) and `App.tsx:1582` (header `onRefresh`) into one `handleRefreshChat(sessionId)` `useCallback` with deps `[send, setSessionStates, beginLoadingHistory]`, carrying the body verbatim including the pre-existing `subscribedRef.delete(sid)` + `.add(sid)` no-op.
- [x] 4.2 `await replayPersisterRef.current.drop(sid)` FIRST, then the in-memory reset and the `lastSeq: 0` resubscribe. Wire both call sites to `handleRefreshChat(selectedId)` and delete the inline blocks.

## 5. Tests — L1 unit (vitest)

- [x] 5.1 Key match is a hit: entry `{sessionId:"s1", serverKey:"a:8000", schemaVersion:3}` · `get("s1","a:8000")` · returns the entry and bumps `lastAccess`. See `packages/client/src/lib/__tests__/replay-cache.test.ts`. (test-plan #E1)
- [x] 5.2 Key mismatch is a non-destructive miss: same entry · `get("s1","b:8000")` · returns `null` AND a later `get("s1","a:8000")` still returns it. See `packages/client/src/lib/__tests__/replay-cache.test.ts`. (test-plan #E2)
- [x] 5.3 Schema check precedes key check: v2-shaped entry with no `serverKey` · `get("s1","a:8000")` · returns `null` AND the entry is deleted. See `packages/client/src/lib/__tests__/replay-cache.test.ts`. (test-plan #E3)
- [x] 5.4 Default-port normalization: `ws://box/ws` and `ws://box:80/ws` · derive key · both yield exactly `box:80`. See `packages/client/src/lib/__tests__/replay-cache.test.ts`. (test-plan #E4)
- [x] 5.5 Key derivation boundaries: `wss://box/ws`, `wss://box:443/ws`, `ws://box:8000/ws` · derive key · `box:443`, `box:443`, `box:8000`. See `packages/client/src/lib/__tests__/replay-cache.test.ts`. (test-plan #E5)
- [x] 5.6 Mismatch does not refresh LRU age: store at `maxEntries` with one foreign entry read via a mismatching key · a `put` triggering `evictIfNeeded` · the foreign entry is evicted first. See `packages/client/src/lib/__tests__/replay-cache.test.ts`. (test-plan #E6)
- [x] 5.7 Over-cap delete stays unkeyed: foreign entry for `"s1"` plus an oversized payload · `put("s1", oversized, "b:8000")` · the `"s1"` entry is deleted and nothing is persisted. See `packages/client/src/lib/__tests__/replay-cache.test.ts`. (test-plan #E7)
- [x] 5.8 Refresh is session-scoped: entries for `X` and `Y` · `handleRefreshChat("X")` · `X` deleted, `Y` intact and still delta-rehydrates. See `packages/client/src/lib/__tests__/refresh-chat.test.ts`. (test-plan #E8)
- [x] 5.9 In-page refresh behaviour preserved: mounted session · `handleRefreshChat(sid)` · state reset to `createInitialState()`, `maxSeqMapRef[sid] === 0`, `subscribe` with `lastSeq: 0`, `beginLoadingHistory` called. See `packages/client/src/lib/__tests__/refresh-chat.test.ts`. (test-plan #F2)
- [x] 5.10 Durable-first ordering: persister double whose `drop` resolves on a deferred promise · `handleRefreshChat(sid)` · `drop` settles BEFORE the first `setSessionStates` / `subscribe` — assert ordering, not occurrence. See `packages/client/src/lib/__tests__/refresh-chat.test.ts`. (test-plan #F3)
- [x] 5.11 Switch discards previous-server buffers: unflushed `descended` buffers recorded under key `a:8000` · `resetBuffers()` then getter returns `b:8000` and a flush is attempted · no `put` occurs for those sessions. See `packages/client/src/lib/__tests__/replay-persist.test.ts`. (test-plan #F4)
- [x] 5.12 Switch-back still delta-replays: entry written under `a:8000`, id never opened under `b:8000` · key returns to `a:8000`, `rehydrateSession` · returns `lastSeq === entry.maxSeq`. See `packages/client/src/lib/__tests__/rehydrate-session.test.ts`. (test-plan #F5)
- [x] 5.13 Cross-server open is a miss: entry written under `a:8000` · `rehydrateSession("s1", cache, "b:8000")` · returns `null` and the caller subscribes `lastSeq: 0`. See `packages/client/src/lib/__tests__/rehydrate-session.test.ts`. (test-plan #F6)
- [x] 5.14 Straggler attribution bound: after `resetBuffers()` and a `seed()` from B restoring `descended`, a late contiguous A-origin live frame · debounce elapses · whatever persists is stamped `b:8000`. See `packages/client/src/lib/__tests__/replay-persist.test.ts`. (test-plan #F8)
- [x] 5.15 Unavailable store does not impair refresh: cache built with no `IDBFactory` · `handleRefreshChat(sid)` · settles, in-memory reset happens, `subscribe` with `lastSeq: 0`, no error surfaced. See `packages/client/src/lib/__tests__/refresh-chat.test.ts`. (test-plan #X1)
- [x] 5.16 Failed switch touches nothing: `openStagingSocket` rejects · `performServerSwitch` · `clearInMemoryState` never invoked, buffers and entries intact, `notifyError` called once. See `packages/client/src/lib/__tests__/server-switch.test.ts`. (test-plan #X2)
- [x] 5.17 Failed delete does not break refresh: `cache.delete` backed by an erroring transaction · `handleRefreshChat(sid)` · refresh still completes its reset and `lastSeq: 0` subscribe (documents the accepted residual — no guard by design). See `packages/client/src/lib/__tests__/refresh-chat.test.ts`. (test-plan #X3)
- [x] 5.18 Schema migration purge: store pre-populated with several v2 entries · first `get` per session after the bump · all purged, all degrade to `lastSeq: 0`, no re-reduce crash. See `packages/client/src/lib/__tests__/replay-cache.test.ts`. (test-plan #X4)
- [x] 5.19 Update every existing double and call site broken by the widened `get`/`put` signatures — `replay-cache.test.ts`, `replay-persist.test.ts` (`spyCache` at line 19 plus its `cache.get("s1")` calls), `rehydrate-session.test.ts`, `rehydrate-session.poisoned-cache.test.ts`, and the persister fakes in the `useMessageHandler` replay tests.

## 6. Tests — L3 Playwright e2e

- [x] 6.1 Refresh-then-reload does not resurrect: session with a flushed entry · click Refresh Chat then reload before the 1 s debounce · subscribe carries `lastSeq: 0` and the transcript converges to the server's. See `tests/e2e/replay-delta-on-reload.spec.ts`; read the harness port from `.pi-test-harness.json` (`dashboardPort`), never hardcode `:18000`. (test-plan #F1)
- [x] 6.2 Happy-path delta regression: normal single-server session, no switch or refresh · reload after a flush · still delta-subscribes from the persisted cursor. See `tests/e2e/replay-delta-on-reload.spec.ts`. (test-plan #F7)

## 7. Manual verification (deferred post-merge)

- [ ] 7.1 Refresh Chat on a large session still repaints immediately after the added IndexedDB await — subjective, no spec threshold. (test-plan: manual-only)
- [ ] 7.2 Run two dashboards on different ports, alternate between them opening sessions on each with reloads in between; confirm no cross-server history appears and switching back still paints instantly. Automatable only with a two-dashboard harness — see test-plan "New infra needed". (test-plan: manual-only)

## 8. Verification

- [x] 8.1 `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` then `grep -nE 'FAIL|Error|✗|✘|Tests +[0-9]+ (failed|passed)' /tmp/pi-test.log` — green.
- [x] 8.2 `npm run quality:changed` clean on the touched files.
- [ ] 8.3 `npm run build && curl -X POST http://localhost:8000/api/restart` (client change → build + restart).
- [x] 8.4 Confirm `performServerSwitch` and `ServerSwitchDeps` are unmodified in the final diff — D3 asserts the switch coordinator is untouched.
- [x] 8.5 Run the `review-code` discipline skill on the diff before commit.

## 9. Documentation

- [x] 9.1 Update the per-file rows for `replay-cache.ts`, `replay-persist.ts`, `rehydrate-session.ts`, and `App.tsx` in their directory `AGENTS.md` files with the new signatures and a `See change: purge-replay-cache-on-reset-paths` marker.
- [x] 9.2 If `docs/architecture.md` documents replay-cache lifetime or the schema version, delegate the prose edit to `DocScribe` (caveman style) to record server-scoped entries and the v3 bump.
- [x] 9.3 Note that the `fix-poisoned-replay-cache` project skill's manual devtools remedy is now largely superseded by Refresh Chat — revisit as a follow-up, do not edit the skill here.
