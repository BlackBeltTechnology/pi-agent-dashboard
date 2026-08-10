## Why

The durable replay cache (`pi-dashboard-replay-cache` in IndexedDB) has **three
reset paths that clear every in-memory layer and skip the durable one**. This is
one systematic omission with three instances, not three unrelated gaps.

**1. "Refresh Chat" does not refresh the cache.** `App.tsx:1560` (and the
duplicated block at `App.tsx:1582`) resets `sessionStates`, zeroes
`maxSeqMapRef`, and resubscribes with `lastSeq: 0` to force a full replay — but
never calls `replayPersister.drop()`. So the button a user reaches for
*precisely when the chat looks wrong* leaves the wrong data on disk. Refresh →
looks fixed → reload the page → `rehydrateSession` pulls the stale entry back →
broken again. It self-heals only if the debounced persister happens to flush
before the reload wins the race. This is the failure the
`fix-poisoned-replay-cache` project skill exists to hand-fix in devtools.

**2. Server switch does not clear the cache.** `performServerSwitch` repoints the
WebSocket **in place** — same document, same origin, so one IndexedDB
accumulates every server the browser has ever connected to. `clearInMemoryState`
(`App.tsx:623-641`) clears `sessions`, `sessionStates`, `sessionCommands`,
`terminals`, `subscribedRef`, `maxSeqMapRef`, `rehydratedRef`, and the recovery
offer. Its own comment reasons explicitly about *"switching back to a server that
still has the same sessionId"* — so cross-server `sessionId` collision was already
considered and handled at every in-memory layer. The durable layer was left out of
that list.

**3. Nothing ever reclaims orphans.** `session_removed` leaves the entry behind,
and no path reconciles the store against the sessions a server actually has.
Orphans are bounded only by the 50-entry LRU (worst case ~250 MB at the 5 MB
per-session cap) and are reclaimed only when a 51st session evicts them.

Harm is scoped by two verified facts. `seq` **is** stable per session across a
server restart, and `subscription-handler.ts:213` already forces
`session_state_reset` + full replay when `lastSeq > maxSeq`. So a stale cursor
that runs *ahead* of the server is already caught. What is not caught is a stale
entry being served as authoritative on the next load of a session the user just
told the client to forget (case 1), and stale bytes accumulating indefinitely
(cases 2 and 3).

## What Changes

- **`Refresh Chat` drops the session's cache entry.** The refresh handler calls
  `replayPersister.drop(sessionId)` alongside the existing in-memory resets, so
  "refresh" means "forget everything about this session" at every layer. The two
  duplicated nine-line blocks collapse into one shared `handleRefreshChat(sid)`
  callback so the two sites cannot drift.
- **Server switch clears the whole store.** `clearInMemoryState` additionally
  clears every replay-cache entry. Deliberately blunt: dropping the entire store
  costs one full replay per switch and requires **no server identity**, which is
  what makes this change self-contained (see *Explicitly deferred*).
- No protocol change, no server change, no new message type, no schema-version
  bump (nothing about the persisted shape changes).

### Explicitly deferred

**Orphan GC by reconciling against `sessions_snapshot`** is **not** in this
change, despite being the direct fix for case 3. It cannot be done safely today:

- `sessions_snapshot` (`browser-gateway.ts:515`, `sessionManager.listAll()`) is
  correctly unfiltered — no hidden/ended filter — so it is a usable reconcile
  source. That part is fine.
- But the store has **no server identity**. `serverId`/`instanceId` do not exist
  anywhere in the repo; a server is keyed only by `host:port`. Since switching
  servers does not change origin, a naive reconcile on connect to server B would
  classify server A's entries as orphans and **delete them** — turning "user
  alternates between two dashboards" into "cache never hits". Reconcile therefore
  requires a per-entry server identity first.
- `host:port` is too weak to be that identity: one machine reached via
  `localhost:8000`, a LAN IP, and a zrok tunnel yields three keys for one server,
  fragmenting the cache. A robust fix needs a server-generated id on the wire —
  a shared-protocol addition, and a scope decision of its own.

Clearing the store on switch (above) makes cross-server contamination moot in the
meantime, at the cost of a full replay per switch.

**Dropping on `session_removed`** is also deferred, deliberately. With `seq`
stability confirmed, an orphaned entry is bytes only — never a wrong view — and
it is bounded by the LRU. Adding a second purge site buys earlier reclamation of
a bounded, harmless quantity while creating another site that must stay in sync.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `session-replay-persistence`: adds a **client-initiated invalidation**
  requirement to the existing "cache is an optimization only" contract. A user
  action that resets a session's chat, and a switch to a different server, SHALL
  invalidate the corresponding durable entries — so no reset path leaves the
  durable layer authoritative over state the client was told to discard. The
  capability currently states no requirement about entry lifetime at all.

## Impact

- `packages/client/src/App.tsx` — extract the duplicated refresh block into one
  `handleRefreshChat(sid)` callback that also calls `replayPersister.drop(sid)`;
  wire it to both the header `onRefresh` and `mobileActions.onRefresh`. Add a
  full-store clear to `clearInMemoryState`.
- `packages/client/src/lib/replay/replay-cache.ts` — add a `clear()` method to
  the `ReplayCache` interface (the store has `get`/`put`/`delete` only).
- `packages/client/src/lib/replay/replay-persist.ts` — expose the store-wide
  clear through the persister so buffered-but-unflushed state is dropped too,
  matching how `drop()` already clears both the buffer and the entry.
- Tests: vitest alongside the existing `useMessageHandler.replay-cache.test.tsx`
  and `rehydrate-session.poisoned-cache.test.ts`.
- **Not changed:** `session_state_reset` → `drop()` (`useMessageHandler.ts:378`),
  the schema-mismatch purge, the LRU, and the 5 MB cap all keep current
  semantics.
- Possible follow-up: the `fix-poisoned-replay-cache` project skill exists only
  because there is no user-facing way to clear this cache. Once `Refresh Chat`
  purges, that skill's manual devtools remedy is largely retired and it should be
  revisited.

### Observed, not fixed here

`subscribedRef.current.delete(id)` immediately followed by
`.add(id)` in both refresh blocks is a no-op on a `Set`. Pre-existing; flagged
rather than changed, since the refactor must be behaviour-preserving.

## Discipline Skills

`doubt-driven-review` (before the invalidation invariant stands — the
store-wide clear on switch is the blunt option and deserves a challenge) ·
`scenario-design` (the `test-plan.md` manifest, notably the
refresh-then-reload race) · `review-code` (before commit, once vitest is green).
