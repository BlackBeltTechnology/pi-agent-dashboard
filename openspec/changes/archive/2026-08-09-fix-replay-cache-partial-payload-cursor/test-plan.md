# Test Plan — fix-replay-cache-partial-payload-cursor

Stage: design   Generated: 2026-08-08

Gate: HARD. One clarification was raised (provenance for a cold replay starting at
`seq > 1`) and **resolved** before this file was written — provenance is decided by
message kind (replay envelope vs live event), not by first seq. No open markers.

Constants referenced by the Triples (verified in source):
`REPLAY_CACHE_SCHEMA_VERSION = 1` → bumps to `2`; persist debounce `1000 ms`;
`DEFAULT_MAX_ENTRIES = 50`; `DEFAULT_MAX_BYTES_PER_SESSION = 5 MiB`;
`shouldReset = firstSeq === 1 || firstSeq <= maxSeq` (`useMessageHandler.ts:632`).

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Cursor descends from replay | decision-table | L1 | automated | fresh persister; no seed, no replay for session X | `record(X, [{seq:250, event}])` (live origin) then `flush(X)` | `cache.put` NOT called; store holds no entry for X |
| E2 | Cursor descends from replay | decision-table | L1 | automated | fresh persister | `seed(X, [{seq:1..3}])` then `flush(X)` | `cache.put` called once with `maxSeq:3`, payload length 3 |
| E3 | Cold replay past seq 1 | decision-table | L1 | automated | fresh persister; cold subscribe `lastSeq:0` | `record(X, [{seq:5},{seq:6}], origin:"replay")` then `flush(X)` | `cache.put` called with `maxSeq:6` — a compacted/capped cold replay is still persisted |
| E4 | Cursor descends from replay | state-transition | L1 | automated | buffer established by replay (`descended`) | live `record(X,[{seq:7}])` then `flush(X)` | `cache.put` called with `maxSeq:7` — live appends onto a descended buffer stay persistable |
| E5 | Live-path gap voids cursor | BVA | L1 | automated | descended buffer, highest seq = 10 | live `record(X,[{seq:11}])` (exactly max+1) then `flush(X)` | `cache.put` called with `maxSeq:11` — the just-contiguous boundary is NOT a gap |
| E6 | Live-path gap voids cursor | BVA | L1 | automated | descended buffer, highest seq = 10 | live `record(X,[{seq:12}])` (max+2, one frame lost) then `flush(X)` | `cache.put` NOT called; buffer marked non-descended |
| E7 | Live-path gap voids cursor | state-transition | L1 | automated | buffer voided by a live gap | subsequent `seed(X, replayEvents)` then `flush(X)` | `cache.put` called again — re-seeding restores provenance |
| E8 | Compaction gap tolerated | decision-table | L1 | automated | fresh persister | `record(X, [{seq:3},{seq:7},{seq:9}], origin:"replay")` (compaction holes) then `flush(X)` | `cache.put` called with `maxSeq:9` — replay-path gaps are not treated as loss |
| E9 | Pre-change entries purged | EP | L1 | automated | store holds entry `{schemaVersion:1, maxSeq:250, payload:[1 stray event]}` | `cache.get(X)` on a client at `schemaVersion:2` | returns `null` AND the stale entry is deleted from the store |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | Broadcast-only buffer never persisted | state-convergence | L3 | automated | dashboard open on session A; session B active in another cwd, never opened in this browser | B emits a live event (e.g. a command-feedback row) that reaches this tab by broadcast; wait > 1 s debounce; reload; open B | B's chat converges to its FULL transcript (message count > 1), not to the single stray row |
| F2 | Poisoned entry self-heals on upgrade | state-transition | L3 | automated | IndexedDB seeded with `{schemaVersion:1, maxSeq:<high>, payload:[1 event]}` for session B | load the upgraded client and open B | B renders its full transcript; no storage clearing performed by the user |
| F3 | Replay-established buffer still delta-replays | state-convergence | L3 | automated | session B opened once (entry written), then reloaded | reload and open B | subscribe carries `lastSeq > 0` (delta, not full) AND the chat still converges to the full transcript |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Sibling tab not destroyed | fault-injection (shared state) | L1 | automated | store holds a descended entry for X written by tab A (`maxSeq:200`) | tab B (broadcast-only buffer for X) runs `flush(X)` | tab A's entry is unchanged (`maxSeq` still 200); no `cache.delete(X)` issued |
| X2 | Non-descended flush is silent | fault-injection (log noise) | L1 | automated | broadcast-only buffers for 5 sessions | a debounce flush cycle for all 5 | zero `console.warn`/`console.error` emitted by the persister |
| X3 | Rehydrate fault-isolation preserved | fault-injection (throw) | L1 | automated | entry at current `schemaVersion` whose payload makes the reducer throw | `rehydrateSession(X, cache)` | returns `null`, deletes the entry, logs exactly one `[rehydrate]` warning — existing behaviour NOT regressed |
| X4 | Healthy seq-5 entry still valid | fault-injection (regression guard) | L1 | automated | entry at current `schemaVersion` with payload `[{seq:5},{seq:7}]` | `rehydrateSession(X, cache)` | returns `{lastSeq:7, ...}` — the existing "healthy entry starting at seq 5" scenario still passes |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | Schema bump traffic cost | threshold | L1 | automated | 50 cached sessions at `schemaVersion:1` | every `get` returns `null` exactly once per session, then normal caching resumes (no repeated purge loop) | one load cycle |

---

## Coverage summary

- Requirements covered: 3/3 (cursor provenance · live-path gap · one-shot purge)
- Scenarios by class: edge 9 · perf 1 · frontend 3 · error 4
- Scenarios by level: L1 14 · L2 0 · L3 3
- Scenarios by disposition: automated 17 · manual-only 0

## New infra needed

None. L1 rows extend the existing vitest suites
(`useMessageHandler.replay-cache.test.tsx`, `rehydrate-session.poisoned-cache.test.ts`);
L3 rows extend the existing Playwright harness in `tests/e2e/` against the
`docker/test-up.sh` derived `dashboardPort` from `.pi-test-harness.json`.
