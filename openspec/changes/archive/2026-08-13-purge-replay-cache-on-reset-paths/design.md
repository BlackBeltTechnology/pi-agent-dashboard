## Context

The durable replay cache (`pi-dashboard-replay-cache`, IndexedDB, one `sessions`
object store keyed by `sessionId`) is a client-side optimization introduced by
`reduce-session-replay-traffic`. Three layers own it today:

- `lib/replay/replay-cache.ts` — `ReplayCache { get, put, delete }`, LRU by
  `lastAccess` (50 entries), 5 MB/session cap, every op wrapped in `safe()` so a
  failure degrades to a full replay.
- `lib/replay/replay-persist.ts` — `ReplayPersister { record, seed, drop, flush }`,
  a per-session RAW event buffer flushed on a 1 s debounce, plus the
  `descended`/`contaminated` provenance sets from
  `fix-replay-cache-partial-payload-cursor`.
- `App.tsx` — owns `replayPersisterRef` (line 586), calls `rehydrateSession` on
  session open (line 926), and passes the persister into `useMessageHandler`.

Exactly one invalidation site exists: `useMessageHandler.ts:379` calls
`drop(sessionId)` on `session_state_reset`. Every other reset path stops at the
in-memory layer: `Refresh Chat` (`App.tsx:1559` mobile, `:1582` header),
`clearInMemoryState` on server switch (`App.tsx:623-641`), and `session_removed`.

Five facts constrain the design. Facts 3–5 were established by two rounds of
adversarial review, and overturned the first two drafts.

1. **`clearInMemoryState` is the switch's commit seam.** `performServerSwitch`
   (`lib/api/server-switch.ts:69`) opens a staging socket first and calls
   `clearInMemoryState()` only after it reaches OPEN. A failed switch never
   reaches the callback.
2. **A surviving entry is not inert — it is authoritative.**
   `rehydrateSession` returns `lastSeq: entry.maxSeq`, so a stale entry produces
   a *delta* subscribe, and `useMessageHandler.ts:676` only rebuilds the buffer
   when the replay's `firstSeq <= maxSeq` trips `shouldReset`. Otherwise the
   delta **appends to a stale base**. "The next replay supersedes it" is false in
   general.
3. **`safe()` is the wrong failure posture for invalidation.** For `get`/`put` a
   swallowed error degrades to a full replay — benign, and the capability's
   stated contract. For `delete` a swallowed error degrades to a **stale hit**,
   the opposite direction.
4. **Provenance cannot identify a socket.** `descended`/`contaminated` distinguish
   *replay-descended vs not* and *contiguous vs gapped* — never *which server
   sent this*. After a switch the client subscribes `lastSeq: 0`, so server B's
   replay has `firstSeq === 1`, trips `shouldReset`, and calls `seed()`
   (`replay-persist.ts:82-87`) — which re-adds `descended` and clears
   `contaminated`. Any server-A frame arriving after that point, contiguous with
   B's tail, is appended to a descended buffer and persisted. Provenance is
   therefore **not** a defence against cross-server contamination.
5. **An epoch/generation guard in the persister cannot order IndexedDB
   transactions.** `flush()`'s only await *is* `await cache.put()`
   (`replay-persist.ts:73`); a check before it spans no yield, and a check after
   it comes when the write has already committed. Any guard that must beat a
   queued IDB transaction has to live inside the cache layer or compensate after
   the fact.

Facts 4 and 5 are what killed the "clear the whole store on switch" approach: it
required guarding a race that provenance does not cover and that a persister-level
guard structurally cannot close.

## Goals / Non-Goals

**Goals:**

- `Refresh Chat` invalidates that session's durable entry, scoped to it, and does
  so *before* the in-memory reset.
- An entry written against one server is never served to another.
- Buffered-but-unflushed content from the previous server is never persisted
  under the new server's identity.
- The two duplicated refresh blocks collapse into one callback so they cannot
  drift.
- No protocol change, no server change, no new message type.

**Non-Goals:**

- Orphan GC by reconciling against `sessions_snapshot` — now *possible* thanks to
  `serverKey`, deliberately left as a follow-up (proposal, *Explicitly deferred*).
- A server-generated `serverId` on the wire. `host:port` is sufficient for
  correctness and imperfect only for hit rate (D2).
- Dropping on `session_removed`.
- Guarding the `session_state_reset` invalidation against a failed delete — that
  site keeps current semantics per the change's constraints.
- Guarding a *failed* refresh delete at all. See D6: the guard that would do it is
  unreachable, and the residual it would cover is not addressable by page-lifetime
  state.
- Distinguishing two different servers that occupy the same `host:port`. See D2.
- Fixing the pre-existing `subscribedRef.delete(id)` + `.add(id)` no-op in the
  refresh blocks; the extraction must be behaviour-preserving.
- Any user-visible surface (no toast, no confirm, no new button).
- Cross-tab coordination — **not needed** under this design (D3).

## Decisions

### D1 — Entries record their server; `get()` filters on it

`ReplayCacheEntry` gains `serverKey: string`. `get(sessionId, serverKey)` returns
`null` when the stored key differs, exactly as it already does for a
`schemaVersion` mismatch. `put(sessionId, value, serverKey)` stamps it.

**`delete(sessionId)` stays unkeyed.** Three internal call sites delete without
any notion of a current server — the schema-mismatch purge (`replay-cache.ts:84-87`),
the over-cap branch in `put()` (`:112-115`), the poisoned-entry catch in
`rehydrate-session.ts:48` — plus the external `session_state_reset` drop
(`useMessageHandler.ts:379`), whose semantics the change is required not to alter.
Adding a key parameter would make each of those a no-op against a foreign entry,
which is a silent semantic change at four sites to buy nothing.

**The schema check must run BEFORE the key check** in `get()`. A v2 entry has no
`serverKey`, so a key-first ordering would classify it as a foreign entry, decline
to delete it (below), and leave it as an immortal zombie miss until the LRU
reclaims it. Schema-first keeps the v2 purge free.

**A key mismatch must NOT delete the entry** — unlike a schema mismatch, where
the entry is worthless to everyone. A foreign entry is valuable to the server
that wrote it, and deleting it would turn "user alternates between two
dashboards" into "cache never hits". Mismatches are left for the LRU. This is the
one place where the two mismatch cases must behave differently, and it is easy to
get wrong by pattern-matching on the existing schema branch.

`REPLAY_CACHE_SCHEMA_VERSION` bumps 2 → 3. The bump is not incidental: v2 entries
carry no `serverKey` and are therefore *unattributable*, so they must not be
served to anyone. The existing schema-mismatch branch already deletes them on
first read, so the purge is free.

*Alternative — a compound `[serverKey, sessionId]` keyPath:* rejected. It changes
the object store's key structure, forcing an IndexedDB `version` bump and an
`onupgradeneeded` migration, for a benefit (both servers' entries for a colliding
id coexisting) that only matters when ids actually collide across servers — rare,
and degrading to a full replay when it happens.

**Consequence of keeping `keyPath: "sessionId"`:** the store holds *one* entry per
session id, and `put` overwrites. So a colliding id opened on server B destroys
server A's entry for that id. Entries survive a round trip only for ids that are
not touched on the other server — which is the common case, since ids are not
shared across servers, but it is weaker than "switching back always hits".

### D2 — `serverKey` is `host:port`, derived from `wsUrl`

The client already parses host and port out of `wsUrl` (`App.tsx`
`currentServerHost`). No protocol change, no server change, no new message.

The proposal originally rejected `host:port` as "too weak": one machine reached
via `localhost:8000`, a LAN IP, and a zrok tunnel produces three keys for one
server. That objection is real but misclassified. Fragmentation is a **hit-rate**
cost — the same session gets a full replay per access path. Contamination is a
**correctness** cost — the user is shown another server's history. Trading a rare
extra full replay for the elimination of wrong-history is obviously right, and a
real `serverId` later needs only another schema bump.

**`host:port` is not a complete identity, and this design does not claim it is.**
One key can denote two different servers over time: a reused port, a repointed
SSH/zrok tunnel, a replaced container, a server restarted against different data.
In that case the entry is served to a server that did not write it — the exact
failure this change targets — with two mitigations, neither complete:

- The server already forces a full replay when the client's cursor runs ahead of
  it (`subscription-handler.ts`, the `lastSeq > maxSeq` branch). That heals the
  *shorter-history* replacement, which is the common restart shape.
- A replacement whose session has `maxSeq >=` the cached cursor takes the delta
  path and appends its tail onto the stale base. **This is not detected.**

This residual is **pre-existing and not worsened** — today *every* cross-server
case behaves this way; after this change only the same-`host:port` case does. It
is named here rather than hidden because "sufficient for correctness" was the
claim two review rounds rejected. Closing it fully requires a server-generated
id on the wire, which is the deferred follow-up.

*Alternative — add `serverId` to the wire now:* rejected as a shared-protocol
change and a scope decision of its own; it would make this change span three
packages instead of one.

### D2b — `serverKey` is threaded explicitly, never read from module state

The key is needed at two moments that are far apart in time from the switch:
`put` (inside the persister's debounced `flush`, minutes later, on a timer) and
`get` (inside `rehydrateSession`, on session open). Getting this wrong is how the
design would reintroduce the hidden shared state the last two rounds punished, so
the mechanism is stated rather than left to implementation:

- `App.tsx` owns `serverKeyRef`, updated **synchronously** at the same two points
  that already set `wsUrl`: initial mount, and the `setWsUrl` inside the switch
  commit. One derivation helper turns a `wsUrl` into the key so mount and switch
  cannot disagree.

**The key is `` `${host}:${port}` ``, with the protocol default port substituted
when the URL omits it** (`ws:` → 80, `wss:` → 443). Normalizing is not cosmetic:
if `ws://box/ws` and `ws://box:80/ws` produced different keys, the *same live
connection* could be attributed two ways across mount vs. switch and every hit
would break — a self-inflicted version of the bug being fixed. The scheme is
deliberately **excluded**: `ws:` and `wss:` on the same host *and* port would
require one port serving two different backends, so including it buys no
correctness and only fragments a server reachable both ways.

This shape is not invented — `App.tsx` already uses `` `${host}:${port}` `` as its
server identity for `LAST_SERVER_KEY`, and `performServerSwitch` already receives
`host` and `port` as discrete values. Reusing it keeps one server-identity format
in the file instead of two.

**A key mismatch must not `touch()` the entry.** The existing `get()` bumps
`lastAccess` for LRU ordering; the key check returns before that, so a foreign
entry ages normally and is evicted ahead of live ones. Bumping it would let a
server the user never returns to hold LRU slots indefinitely.
- `createReplayPersister(cache, debounceMs, getServerKey)` takes a **getter**,
  not a value. `flush()` calls it at flush time, so a buffer flushed after a
  switch is stamped with the current server — which is exactly why D4's buffer
  reset is mandatory rather than cosmetic.
- `rehydrateSession(sessionId, cache, serverKey)` takes the key as a parameter.

Scoping the entry makes the whole switch-time purge unnecessary. Nothing foreign
is *readable*, so nothing needs reclaiming. This is what collapses the design:

| First draft needed | Under D1/D2 |
|---|---|
| `ReplayCache.clear()` | not needed |
| `clearAll()` on the persister (durable) | not needed |
| epoch guard vs in-flight `flush` | not needed (Fact 5 says it could not work anyway) |
| bounded timeout + abort story | not needed |
| page-wide `all` suppression flag | not needed |
| cross-tab coordination (`BroadcastChannel`) | not needed — a sibling tab writes its own server's key |
| a full replay for every session after a switch | **not incurred** for ids untouched on the other server |

`performServerSwitch` and `ServerSwitchDeps` are **untouched**: no widened
signature, no `await`, no `try/catch`, no wedge risk. The failed-switch scenario
still holds for free via Fact 1.

### D4 — The switch discards in-memory buffers (and only those)

One thing *is* required on switch. The persister's buffers were accumulated
against server A, but `flush()` stamps entries with whatever key the getter
returns *at flush time* — which is B's after the switch. So `clearInMemoryState`
calls a new `ReplayPersister.resetBuffers()`: clear every pending timer, empty
`buffers`, `descended`, and `contaminated`.

This is **synchronous and cannot fail** — no IndexedDB, no promise, no ordering
hazard. That is the whole reason D3 is safe: the only switch-time work left is
in-memory, so Fact 5's "a guard cannot order IDB transactions" never applies.

`resetBuffers()` sits beside `maxSeqMapRef.current.clear()` and
`rehydratedRef.current.clear()` in the callback that already declares itself the
"wipe every layer" list.

**Residual: old-socket stragglers.** React's effect cleanup nulls `onclose` and
calls `close()` before the new `connect()` runs, so the teardown *starts* before
the new socket opens. That does not make a late A-frame impossible: `close()` is
an async handshake, and the old socket's `onmessage` closure reads the **shared**
`handlersRef`, so a frame already in flight can still be dispatched after B's
`seed()` — landing on a now-`descended` buffer and being persisted under B's key.
The honest claim is *very unlikely*, not *impossible*.

This is accepted rather than guarded, because the only sound fix is a
socket-identity check in `useWebSocket` (out of scope), and because Fact 5 shows
persister-level guards cannot close it. The blast radius is bounded: a stray
A-frame produces wrong content in a B-attributed entry, which the next
`shouldReset` replay rebuilds — it can no longer produce wrong *attribution*
across a later switch, which was the unbounded failure. D7 tests the hazard that
actually exists (a frame arriving after `seed()`), not the trivially-safe one.

### D5 — `handleRefreshChat(sessionId)` is durable-first and awaited

The nine-line block duplicated at `App.tsx:1559` (`mobileActions.onRefresh`) and
`:1582` (header `onRefresh`) becomes one `useCallback`, moved up with the other
session handlers.

**Ordering is the decision, not the extraction.** The callback `await`s
`replayPersisterRef.current.drop(sid)` **before** resetting `sessionStates`,
zeroing `maxSeqMapRef`, and resubscribing.

An earlier draft issued `drop()` fire-and-forget, arguing the reload race was
harmless because the timer/buffer kill inside `drop()` is synchronous. That is
wrong twice: the synchronous part only prevents a *re-persist*, while the entry
itself is removed by the async `cache.delete()` that a page unload aborts; and
per Fact 2 a surviving entry is rehydrated as authoritative. `replay-persist.ts:33`
already documents the correct posture — *"Awaitable so a fast reload/close after
session_state_reset can't race a surviving entry"* — and this design honours the
contract the persister already declares rather than copying the one call site
that discards it.

Durable-first also makes an *unload* interruption safe in the right direction:
neither layer was reset, a consistent pre-refresh state, rather than an in-memory
reset paired with a surviving entry.

The callback takes `sessionId` as a parameter (not a closure over `selectedId`);
its dependency array is `[send, setSessionStates, beginLoadingHistory]`, and both
call sites pass `selectedId` explicitly. The pre-existing
`subscribedRef.delete(sid)` + `.add(sid)` no-op is carried over verbatim.

### D6 — No guard for a failed refresh delete (considered, cut)

An earlier draft widened `delete` to `Promise<boolean>` and fed failures into a
page-lifetime suppression `Set` consulted by `rehydrateSession`. Both are cut:
the guard is **unreachable on the path it was written for**.

`App.tsx:924` rehydrates only when `!maxSeqMapRef.current.has(sid) &&
!rehydratedRef.current.has(sid)`. `handleRefreshChat` sets `maxSeqMapRef` to `0`
and never clears `rehydratedRef`, so a later open of that session **in the same
page** does not call `rehydrateSession` at all — it already subscribes
`lastSeq: 0` from the in-memory cursor. A guard consulted at the rehydrate call
site therefore cannot fire for the scenario it was added to satisfy, and a test
asserting "the next open skips rehydrate" would pass trivially via
`rehydratedRef` while exercising nothing.

The failure the guard was meant to cover — a failed delete surviving to the
**next page load** — is by definition beyond page-lifetime state. Covering it
needs a persisted tombstone or a retry, both heavier than an IndexedDB delete
failure warrants, and both new machinery on the exact kind of path the last two
review rounds punished.

So `delete` keeps `Promise<void>` and its `safe()` wrapper, and the residual is
stated in Risks instead of half-mitigated. The corresponding spec requirement is
withdrawn rather than left as a `SHALL` nothing implements.

### D7 — Tests target the seams and the hard scenarios

- `replay-cache.ts` — a key mismatch is a miss **and leaves the entry intact**
  (the D1 trap); a schema mismatch still deletes; a v2-shaped entry is purged
  (proving schema-before-key ordering); the over-cap `del` still fires against a
  foreign entry (unkeyed delete).
- `replay-persist.ts` — `resetBuffers()` cancels timers and empties buffers +
  provenance; a flush after a switch stamps the **new** key.
- `handleRefreshChat` — `drop(sid)` is awaited **before** the reset/resubscribe
  (assert call ordering, not just occurrence); called for the refreshed session
  and not a sibling; in-memory resets and the `lastSeq: 0` subscribe unchanged
  for both call sites.
- Straggler (D4) — the test must reproduce the **real** hazard: a server-A frame
  recorded *after* a `seed()` has restored `descended`. Asserting on a frame
  recorded right after `resetBuffers()` proves nothing (it is `contaminated`, so
  `flush` skips it for reasons unrelated to this change). The assertion is on
  attribution: whatever is persisted carries the key of the server that is
  current at flush time.
- Switch-back — an entry written on A is a miss while on B, and a hit again after
  switching back, **for a session id not opened on B**.

Test-impact inventory: the widened `get`/`put` signatures break every existing
call site that passes only a session id — in `replay-persist.test.ts`,
`replay-cache.test.ts`, `rehydrate-session` tests, and the persister fakes in the
`useMessageHandler` tests. `spyCache` (`lib/__tests__/replay-persist.test.ts:19`)
adapts by shape but its `cache.get("s1")` call sites do not.

The exact scenario→test mapping is owned by `test-plan.md` (`scenario-design`),
not by this document.

## Risks / Trade-offs

- **Cache fragmentation across access paths.** The same server reached via
  `localhost`, LAN IP, and zrok yields three keys and three cold caches. →
  Accepted per D2: a hit-rate cost, not a correctness one. A real `serverId`
  fixes it later behind one more schema bump.
- **The schema bump discards every existing entry once.** → Intended; v2 entries
  are unattributable. One full replay per session on first load after deploy,
  exactly as the v1→v2 bump did.
- **The LRU's 50 entries are now shared across servers**, so a user alternating
  between two dashboards halves the effective per-server capacity. → Accepted;
  still far better than the superseded design, which guaranteed a *full* replay
  for every session on every switch.
- **`get`/`put` signatures change, so every call site must pass the key.** →
  Contained: `rehydrateSession` and the persister's `flush` are the only
  production callers; the compiler finds them, and the test doubles break loudly
  rather than silently. `delete` is deliberately left alone (D1).
- **A replacement server at the same `host:port` with a longer history is served
  a stale base.** → Named in D2, not fixed. Pre-existing, narrowed by this change
  rather than introduced, and closed only by a real `serverId`.
- **A failed refresh delete still survives to the next page load.** → Accepted
  (D6). Rare, and the alternatives are a persisted tombstone or a retry loop.
- **A late straggler from the old socket can be persisted under the new server's
  key.** → Accepted (D4); bounded to wrong content in a correctly-attributed
  entry, rebuilt by the next `shouldReset` replay. The real fix is socket identity
  in `useWebSocket`, out of scope.
- **Extracting the duplicated refresh block can silently change behaviour.** →
  The extraction is verbatim apart from the awaited `drop()` and the ordering; a
  test pins the unchanged parts for both call sites.
- **`Refresh Chat` now awaits IndexedDB before repainting.** → One transaction on
  an indexed key. If the store is unavailable the promise settles `false` rather
  than hanging, and the refresh proceeds.
- **The `fix-poisoned-replay-cache` project skill's devtools remedy becomes
  largely redundant.** → Flagged in the proposal as a follow-up; revisit after
  this lands rather than editing the skill inside this change.
