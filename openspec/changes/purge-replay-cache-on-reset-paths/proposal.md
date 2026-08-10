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
- **Entries are scoped to the server that wrote them.** Each entry records a
  `serverKey` (`host:port`, derived from `wsUrl` — information the client already
  has). `get()` treats a key mismatch as a miss, exactly as it already treats a
  `schemaVersion` mismatch. A switch therefore needs **no durable purge at all**:
  nothing foreign is readable, so nothing has to be reclaimed. `clearInMemoryState`
  additionally discards the persister's in-memory buffers, so server A's buffered
  content cannot be flushed under server B's key.
- No protocol change, no server change, no new message type. **`REPLAY_CACHE_SCHEMA_VERSION`
  bumps to 3** — the persisted shape gains a field, and the bump purges v2 entries
  (which carry no server identity and are therefore unattributable) on first read,
  exactly as the v2 bump purged ambiguous v1 cursors.

> **Superseded approach.** An earlier draft cleared the entire store on switch,
> chosen as the blunt option that needed no server identity. Adversarial review
> killed it: the old socket stays open until React tears it down, so server A
> frames can still arrive after the clear, and once server B's `lastSeq: 0`
> replay calls `seed()` the buffer is descended again — A's stragglers then ride
> B's buffer into the store. Provenance distinguishes *descended vs not*, never
> *which socket*. Patching that needed an epoch guard, a timeout, and a
> suppression flag, each of which introduced its own defect. Scoping the entry
> removes the entire class instead of guarding it, and is strictly cheaper.

### Explicitly deferred

**Orphan GC by reconciling against `sessions_snapshot`** is **not** in this
change, despite being the direct fix for case 3. `sessions_snapshot`
(`browser-gateway.ts:515`, `sessionManager.listAll()`) is correctly unfiltered —
no hidden/ended filter — so it is a usable reconcile source, and with `serverKey`
on the entry a reconcile can now be scoped to the current server without
classifying another server's entries as orphans. That makes GC *possible* as a
follow-up; it is left out here to keep this change to one idea. Orphans stay
bounded by the 50-entry LRU in the meantime.

**A server-generated id on the wire** is also deferred. `host:port` is a weaker
identity than a real `serverId`: one machine reached via `localhost:8000`, a LAN
IP, and a zrok tunnel yields three keys for one server, fragmenting the cache.
That is accepted deliberately — fragmentation costs a full replay, whereas the
bug being fixed shows the wrong server's history. `host:port` is *sufficient for
correctness* (distinct servers never share a key) and merely *imperfect for hit
rate*. A real `serverId` is a shared-protocol addition and a scope decision of
its own; adopting one later only needs another schema bump.

**Dropping on `session_removed`** is also deferred, deliberately. With `seq`
stability confirmed, an orphaned entry is bytes only — never a wrong view — and
it is bounded by the LRU. Adding a second purge site buys earlier reclamation of
a bounded, harmless quantity while creating another site that must stay in sync.

**Guarding the `session_state_reset` invalidation** against a failed delete is
deferred. That site keeps its current fire-and-forget semantics per the change's
constraints; extending the refresh path's suppression guard to it is a one-line
follow-up, left out so this change touches one invalidation path only.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `session-replay-persistence`: adds a **client-initiated invalidation**
  requirement and an **entry-attribution** requirement to the existing "cache is
  an optimization only" contract. A user action that resets a session's chat
  SHALL invalidate that session's durable entry; an entry SHALL only be served to
  the server that produced it; and an unavailable durable store SHALL NOT impair
  the refresh. The capability currently states no requirement about entry lifetime
  or attribution at all.

## Impact

- `packages/client/src/App.tsx` — extract the duplicated refresh block into one
  `handleRefreshChat(sid)` callback that awaits `replayPersister.drop(sid)`
  *before* the in-memory reset; wire it to both the header `onRefresh` and
  `mobileActions.onRefresh`. Add the persister buffer reset to
  `clearInMemoryState`. Own the `serverKeyRef`, updated synchronously wherever
  `wsUrl` is set.
- `packages/client/src/lib/replay/replay-cache.ts` — add `serverKey` to the entry,
  bump `REPLAY_CACHE_SCHEMA_VERSION` to 3, take the key on `get()`/`put()` and
  treat a mismatch as a miss *without* deleting. `delete()` stays unkeyed.
- `packages/client/src/lib/replay/replay-persist.ts` — take the current-server key
  as an injected getter (read at flush time) and add an in-memory buffer reset for
  the switch path.
- `packages/client/src/lib/replay/rehydrate-session.ts` — take the current
  `serverKey` and pass it through to `get()`.
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
