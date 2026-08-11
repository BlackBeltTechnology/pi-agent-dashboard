# Test Plan — purge-replay-cache-on-reset-paths

Stage: design   Generated: 2026-08-10

One clarification was raised (exact `serverKey` normalization) and resolved into
design D2b before this catalog was written: the key is `` `${host}:${port}` ``
with the protocol default port substituted, scheme excluded. No open markers.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | R2 entry attribution | decision-table | L1 | automated | entry `{sessionId:"s1", serverKey:"a:8000", schemaVersion:3}` | `get("s1","a:8000")` | returns the entry; `lastAccess` bumped |
| E2 | R2 entry attribution | decision-table | L1 | automated | entry `{sessionId:"s1", serverKey:"a:8000", schemaVersion:3}` | `get("s1","b:8000")` | returns `null` **and** a subsequent `get("s1","a:8000")` still returns the entry (mismatch must not delete — design D1 trap) |
| E3 | R2 pre-scoping entries | decision-table | L1 | automated | v2-shaped entry: no `serverKey`, `schemaVersion:2` | `get("s1","a:8000")` | returns `null` **and** the entry is deleted from the store (proves schema check runs before key check) |
| E4 | R2 / design D2b | equivalence-partitioning | L1 | automated | `wsUrl` = `ws://box/ws` and `ws://box:80/ws` | derive key for each | both yield exactly `box:80` (one live connection can never be attributed two ways) |
| E5 | R2 / design D2b | BVA | L1 | automated | `wss://box/ws`, `wss://box:443/ws`, `ws://box:8000/ws` | derive key for each | `box:443`, `box:443`, `box:8000` |
| E6 | R2 + LRU semantics | state-based | L1 | automated | store at `maxEntries` with 1 foreign + N live entries; foreign entry read once via a mismatching key | a `put` that triggers `evictIfNeeded` | the foreign entry is evicted first — the mismatching `get` did **not** bump its `lastAccess` |
| E7 | unchanged over-cap semantics | decision-table | L1 | automated | foreign entry for `"s1"` (`serverKey:"a:8000"`); payload for `"s1"` exceeding the 5 MB cap | `put("s1", oversized, "b:8000")` | the `"s1"` entry is deleted (over-cap `del` stays **unkeyed**), no entry persisted |
| E8 | R1 scoping | equivalence-partitioning | L1 | automated | entries for sessions `X` and `Y` | `handleRefreshChat("X")` | `X` deleted; `Y` still present and still rehydrates from its cursor |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | R1 refresh-then-reload | state-transition | L3 | automated | a session with a flushed cache entry (harness exemplar: `tests/e2e/replay-delta-on-reload.spec.ts`) | click Refresh Chat, then reload the page before the 1 s debounce elapses | subscribe frame carries `lastSeq: 0`; rendered transcript converges to the server's, not the pre-refresh one |
| F2 | R1 in-page refresh | state-transition | L1 | automated | mounted session rendering a chat | `handleRefreshChat(sid)` | `sessionStates[sid]` reset to `createInitialState()`, `maxSeqMapRef[sid] === 0`, `subscribe` sent with `lastSeq: 0`, `beginLoadingHistory` called |
| F3 | R1 durable-first ordering | state-transition (illegal edge) | L1 | automated | persister double whose `drop` resolves on a deferred promise | `handleRefreshChat(sid)` | `drop` is observed to **settle before** the first `setSessionStates` / `send({type:"subscribe"})` call — assert ordering, not merely occurrence |
| F4 | R2 buffered content | state-transition | L1 | automated | persister holding unflushed, `descended` buffers recorded while key = `a:8000` | `resetBuffers()` then key getter returns `b:8000`, then a flush is attempted | no `put` occurs for those sessions; nothing attributed to `b:8000` contains `a:8000`-era events |
| F5 | R2 switch-back | state-transition | L1 | automated | entry for `s1` written with key `a:8000`; session id `s1` never opened while key = `b:8000` | key returns to `a:8000`, `rehydrateSession("s1", cache, "a:8000")` | returns the entry with `lastSeq === entry.maxSeq` (delta, not `0`) |
| F6 | R2 cross-server miss | state-transition | L1 | automated | entry for `s1` written with key `a:8000` | `rehydrateSession("s1", cache, "b:8000")` | returns `null`; caller subscribes `lastSeq: 0` |
| F7 | R2 happy-path regression | state-transition | L3 | automated | a normal single-server session, no switch, no refresh (exemplar: `tests/e2e/replay-delta-on-reload.spec.ts`) | reload the page after a flush | still delta-subscribes with the persisted cursor — server keying did not break the existing optimization |
| F8 | design D4 straggler | state-transition (illegal edge) | L1 | automated | after `resetBuffers()`, key getter returns `b:8000`; a `seed()` from B's replay restores `descended`; then a late A-origin frame is `record`ed live and contiguous | debounce elapses → flush | whatever is persisted is stamped `b:8000` (attribution is always the flush-time key) — pins the accepted bound: wrong content is possible, wrong attribution is not |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | R3 unavailable store | fault-injection (abort) | L1 | automated | cache built with no `IDBFactory` (private-browsing shape) | `handleRefreshChat(sid)` | promise settles; in-memory reset happens; `subscribe` sent with `lastSeq: 0`; no toast / no thrown error |
| X2 | R2 failed switch | fault-injection (abort) | L1 | automated | `openStagingSocket` rejects | `performServerSwitch` | `clearInMemoryState` never invoked → `resetBuffers` never runs, stored entries and buffers intact, `notifyError` called once |
| X3 | R1 delete failure | fault-injection (abort) | L1 | automated | `cache.delete` backed by a store whose transaction errors | `handleRefreshChat(sid)` | refresh still completes its in-memory reset + `lastSeq: 0` subscribe (no guard exists by design — D6); documents the accepted residual rather than asserting a purge |
| X4 | R2 schema migration | fault-injection (state) | L1 | automated | store pre-populated with several v2 entries | first `get` per session after the bump to 3 | every v2 entry purged, every session degrades to `lastSeq: 0`, no re-reduce crash |

### Manual-only

| id | requirement | technique | level | disposition | surface | trigger | expected observable |
|----|-------------|-----------|-------|-------------|---------|---------|---------------------|
| M1 | design "refresh awaits IndexedDB" | subjective latency | — | manual-only | session chat header | click Refresh Chat on a large session | [judgment: repaint still feels immediate — the spec defines no latency threshold, so no automatable observable; inventing a p95 here would fabricate a requirement] |
| M2 | R2 end-to-end, two real servers | exploratory | — | manual-only | two running dashboards on different ports | alternate between them, opening sessions on each, reloading in between | [judgment: no cross-server history ever appears; switching back still paints instantly. Automatable only with a two-dashboard harness — see New infra] |

---

## Coverage summary

- Requirements covered: 3/3 (R1 refresh invalidation · R2 entry attribution · R3 unavailable store)
- Scenarios by class: edge 8 · perf 0 · frontend 8 · error 4 · manual 2
- Scenarios by level: L1 18 · L2 0 · L3 2 · — 2
- Scenarios by disposition: automated 20 · manual-only 2

No performance scenarios: the change adds no latency/throughput requirement, and
the one latency-adjacent concern (refresh now awaits IndexedDB) has no
spec-defined threshold, so it is routed to M1 rather than given an invented one.

No L2 (qa VM smoke) scenarios: nothing here is install/spawn/multi-OS runtime —
this is entirely client-side logic plus two rendered-UI reload behaviours.

## New infra needed

- **Two-dashboard E2E harness** — `docker/test-up.sh` derives a single dashboard
  port per worktree (`.pi-test-harness.json` `dashboardPort`), so no existing
  level can drive a genuine server switch between two live servers. M2 is
  manual-only for that reason. If a second harness instance is ever added, M2
  and F5/F6 promote from L1 simulation to a real L3 switch scenario.
