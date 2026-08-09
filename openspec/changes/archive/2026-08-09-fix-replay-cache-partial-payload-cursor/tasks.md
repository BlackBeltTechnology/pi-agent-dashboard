# Tasks — fix-replay-cache-partial-payload-cursor

Test tasks are folded from `test-plan.md` (the manifest is the source of truth for
automated-vs-manual). All 17 manifest rows are `automated`; there are no
`manual-only` rows. TDD order: author the failing L1 tests first, then implement,
then the L3 tests.

## 1. Tests — L1 unit (vitest), written first and verified RED

- [x] Test: a broadcast-only buffer is never persisted — input: fresh persister, no seed and no replay for session X · trigger: `record(X,[{seq:250,event}])` with live origin, then `flush(X)` · observable: `cache.put` not called and no entry stored for X. See `packages/client/src/lib/__tests__/replay-persist.test.ts` (test-plan #E1)
- [x] Test: a seeded buffer persists — input: fresh persister · trigger: `seed(X,[{seq:1..3}])` then `flush(X)` · observable: `cache.put` called once with `maxSeq:3` and payload length 3. See `packages/client/src/lib/__tests__/replay-persist.test.ts` (test-plan #E2)
- [x] Test: a cold replay starting past seq 1 still persists — input: fresh persister, cold subscribe `lastSeq:0` · trigger: `record(X,[{seq:5},{seq:6}])` with replay origin, then `flush(X)` · observable: `cache.put` called with `maxSeq:6`. See `packages/client/src/lib/__tests__/replay-persist.test.ts` (test-plan #E3)
- [x] Test: live appends onto a descended buffer stay persistable — input: buffer established by replay · trigger: live `record(X,[{seq:7}])` then `flush(X)` · observable: `cache.put` called with `maxSeq:7`. See `packages/client/src/lib/__tests__/replay-persist.test.ts` (test-plan #E4)
- [x] Test: the just-contiguous live boundary is not a gap — input: descended buffer with highest seq 10 · trigger: live `record(X,[{seq:11}])` then `flush(X)` · observable: `cache.put` called with `maxSeq:11`. See `packages/client/src/lib/__tests__/replay-persist.test.ts` (test-plan #E5)
- [x] Test: a lost live frame voids the cursor — input: descended buffer with highest seq 10 · trigger: live `record(X,[{seq:12}])` then `flush(X)` · observable: `cache.put` not called, buffer marked non-descended. See `packages/client/src/lib/__tests__/replay-persist.test.ts` (test-plan #E6)
- [x] Test: re-seeding restores provenance after a gap — input: buffer voided by a live gap · trigger: `seed(X, replayEvents)` then `flush(X)` · observable: `cache.put` called again. See `packages/client/src/lib/__tests__/replay-persist.test.ts` (test-plan #E7)
- [x] Test: replay-path (compaction) gaps are tolerated — input: fresh persister · trigger: `record(X,[{seq:3},{seq:7},{seq:9}])` with replay origin, then `flush(X)` · observable: `cache.put` called with `maxSeq:9`. See `packages/client/src/lib/__tests__/replay-persist.test.ts` (test-plan #E8)
- [x] Test: a pre-change entry is purged on schema mismatch — input: stored entry `{schemaVersion:1, maxSeq:250, payload:[1 stray event]}` · trigger: `cache.get(X)` on a client at `schemaVersion:2` · observable: returns `null` and the stale entry is deleted. See `packages/client/src/lib/__tests__/replay-cache.test.ts` (test-plan #E9)
- [x] Test: a broadcast observer does not destroy a sibling entry — input: store holds a descended entry for X with `maxSeq:200` · trigger: a second persister with a broadcast-only buffer for X runs `flush(X)` · observable: the stored entry is unchanged at `maxSeq:200` and no `cache.delete(X)` is issued. See `packages/client/src/lib/__tests__/replay-persist.test.ts` (test-plan #X1)
- [x] Test: non-descended flushes are silent — input: broadcast-only buffers for 5 sessions · trigger: one debounce flush cycle · observable: zero `console.warn`/`console.error` from the persister. See `packages/client/src/lib/__tests__/replay-persist.test.ts` (test-plan #X2)
- [x] Test: rehydrate fault-isolation is not regressed — input: entry at the current `schemaVersion` whose payload makes the reducer throw · trigger: `rehydrateSession(X, cache)` · observable: returns `null`, deletes the entry, logs exactly one `[rehydrate]` warning. See `packages/client/src/lib/__tests__/rehydrate-session.poisoned-cache.test.ts` (test-plan #X3)
- [x] Test: a healthy entry starting at seq 5 still delta-rehydrates — input: entry at the current `schemaVersion` with payload `[{seq:5},{seq:7}]` · trigger: `rehydrateSession(X, cache)` · observable: returns `{lastSeq:7,…}`. See `packages/client/src/lib/__tests__/rehydrate-session.poisoned-cache.test.ts` (test-plan #X4)
- [x] Test: the schema bump purges once, not in a loop — input: 50 cached sessions at `schemaVersion:1` · trigger: one load cycle at `schemaVersion:2` · observable: each `get` returns `null` exactly once, then normal caching resumes. See `packages/client/src/lib/__tests__/replay-cache.test.ts` (test-plan #P1)

## 2. Implementation

- [x] Add per-session provenance to `createReplayPersister` in `packages/client/src/lib/replay/replay-persist.ts`: `descended` flag set by `seed()` and by a replay-origin `record()`, never by a live-origin `record()`; `flush()` persists only when set, and never calls `cache.delete()` on the skip path.
- [x] Add live-path gap detection in `record()`: a live event with `seq > max + 1` marks the buffer non-descended; replay-origin batches are exempt.
- [x] Thread a message-origin argument through the two `record()` call sites in `packages/client/src/hooks/useMessageHandler.ts` (`event` = live, `event_replay` non-reset = replay). Do not gate on `shouldReset` — a compacted or capped cold replay starts at `seq > 1` and must still establish provenance.
- [x] Bump `REPLAY_CACHE_SCHEMA_VERSION` from 1 to 2 in `packages/client/src/lib/replay/replay-cache.ts` so pre-change entries purge once via the existing mismatch path.
- [x] Verify the L1 suite goes GREEN with no changes to `rehydrate-session.ts` semantics.

## 3. Tests — L3 browser e2e (Playwright vs the docker harness)

- [x] Test: a broadcast-only session recovers its full history after reload — input: dashboard open on session A while session B is active but never opened in this browser · trigger: B emits a live event that reaches the tab by broadcast, wait past the 1 s debounce, reload, open B · observable: B's chat converges to its full transcript (message count > 1), not a single stray row. See `tests/e2e/replay-delta-on-reload.spec.ts` (test-plan #F1)
- [x] Test: a poisoned pre-change entry self-heals on upgrade — input: IndexedDB seeded with `{schemaVersion:1, maxSeq:<high>, payload:[1 event]}` for session B · trigger: load the client and open B · observable: B renders its full transcript with no user-performed storage clearing. See `tests/e2e/replay-delta-on-reload.spec.ts` (test-plan #F2)
- [x] Test: a replay-established session still delta-replays on reload — input: session B opened once so an entry is written · trigger: reload and open B · observable: the subscribe carries `lastSeq > 0` and the chat still converges to the full transcript. See `tests/e2e/replay-delta-on-reload.spec.ts` (test-plan #F3)

## 4. Validate

- [x] `npm test` green (whole vitest suite, not just the new files).
- [x] `npm run test:e2e` green for the three folded L3 specs against the harness port read from `.pi-test-harness.json` (never a hardcoded `:18000`).
- [x] `npm run quality:changed` clean.
- [x] Manual confirmation on the originally-affected browser: session `019fd8d5` renders its full transcript after upgrade without clearing site data.
- [x] Update `packages/client/src/lib/replay/*.AGENTS.md` rows for the changed files per the Documentation Update Protocol.
