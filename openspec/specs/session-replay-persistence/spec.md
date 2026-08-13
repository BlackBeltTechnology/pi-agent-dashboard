# session-replay-persistence Specification

## Purpose
Persist a per-session replay cursor + raw event tail to IndexedDB so a page
reload of an already-seen session triggers a delta replay (tail only) instead of
a full replay. The cache is an optimization only — any miss, reset, or version
mismatch degrades safely to full replay.
## Requirements
### Requirement: Durable replay cursor survives page reload

The client SHALL persist a per-session replay cursor (`maxSeq`) and the RAW event
tail (`{ seq, event }[]`, NOT a reduced chat-message snapshot) to IndexedDB, and
SHALL rehydrate on page load by re-reducing those raw events so an already-seen
session resubscribes with a non-zero `lastSeq`, triggering a delta replay rather
than a full replay.

#### Scenario: Reload of a seen session delta-replays

- **WHEN** a session was previously subscribed (cache holds `maxSeq = N`) and the
  page is reloaded
- **THEN** the client SHALL send `subscribe { sessionId, lastSeq: N }`
- **AND** the server SHALL replay only events with `seq > N`
- **AND** the client SHALL NOT request a full replay (`lastSeq: 0`) for that
  session

#### Scenario: Reload of a never-seen session full-replays

- **WHEN** the page is reloaded and no cache entry exists for a session
- **THEN** the client SHALL send `subscribe { sessionId, lastSeq: 0 }`
- **AND** the server SHALL perform a full replay (unchanged behavior)

#### Scenario: Rehydrated state renders before the delta arrives

- **WHEN** a cache entry exists on load
- **THEN** the client SHALL render the rehydrated chat as provisional state
  before the `event_replay` delta arrives
- **AND** SHALL reconcile it against the first replay batch via the existing
  `firstSeq <= maxSeq` reset rule

### Requirement: Cache is invalidated on server-side sequence reset

The persisted cache SHALL be treated as an optimization only. A `session_state_reset`
or a contradicting replay SHALL purge the affected session's entry so stale
history is never stitched onto reset sequence numbers.

#### Scenario: session_state_reset purges the entry

- **WHEN** the server sends `session_state_reset` for a session (its `seq` reset,
  e.g. after a server restart)
- **THEN** the client SHALL delete that session's IndexedDB entry
- **AND** SHALL rebuild chat state from the full replay that follows

#### Scenario: Schema-version mismatch drops the entry

- **WHEN** a cache entry's `schemaVersion` does not match the running client's
  version
- **THEN** the client SHALL ignore and delete that entry
- **AND** SHALL fall back to a full replay for that session

#### Scenario: Eviction never loses data

- **WHEN** the browser evicts the IndexedDB store, or the client LRU drops an
  entry by last-access
- **THEN** the next subscribe for that session SHALL safely fall back to
  `lastSeq: 0` full replay with no error surfaced to the user

### Requirement: Rehydrate is fault-isolated from malformed cached events

Rehydrating a session from the durable IndexedDB replay cache SHALL NOT be able to crash
the application. Because the rehydrate re-reduce runs at App level — above the chat view
error boundary — an uncaught throw while re-reducing a cached event would unmount the
whole React root. The replay cache is an optimization only: any failure to reconstruct
state from it SHALL degrade to a full replay, exactly as a cache miss does.

`rehydrateSession` SHALL isolate the per-entry re-reduce so that a throw for one session
discards that session's cache entry and yields a cache-miss result (caller subscribes
with `lastSeq: 0`, full replay) rather than propagating the error.

#### Scenario: A poisoned cache entry falls back to full replay

- **GIVEN** a durable replay-cache entry for a session whose payload contains an event
  that makes the reducer throw (e.g. a `tool_execution_start` with undefined `toolName`,
  absent the reducer's own tolerance)
- **WHEN** the client cold-loads that session and attempts to rehydrate
- **THEN** the rehydrate SHALL NOT throw or unmount the app
- **AND** it SHALL discard the offending session's cache entry
- **AND** it SHALL return a cache-miss result so the caller performs a full replay
  (`lastSeq: 0`)
- **AND** it SHALL emit a single diagnostic log identifying the fallback

#### Scenario: A healthy cache entry still delta-rehydrates

- **GIVEN** a replay-cache entry whose payload re-reduces without error
- **WHEN** the client cold-loads that session
- **THEN** rehydrate SHALL paint the reduced state and return the persisted cursor for a
  delta subscribe, unchanged from current behaviour

### Requirement: A persisted cursor SHALL descend from a received replay

The client SHALL persist a session's replay cursor (`maxSeq`) only when that
session's event buffer **descends from a replay this client actually received** —
i.e. a rehydrate hit, or **any** `event_replay` batch for that session — and SHALL
NOT persist a buffer accumulated solely from live broadcast events.

Provenance is decided by the **kind of message** that established the buffer
(replay envelope vs live event), NOT by the first sequence number it carries. A
replay envelope only ever arrives in answer to this client's own subscribe, so it
is authoritative regardless of whether it starts at `seq 1`: replay compaction and
the server's replay cap both legitimately produce a cold replay that begins at
`seq > 1`.

Live `event` frames are fanned out to every browser socket regardless of session
subscription, so a client accumulates events for sessions it has never opened.
Such a buffer carries a plausible-looking `maxSeq` derived from its own contents
while representing none of the session's history. Persisting it makes the next
load delta-subscribe past the entire transcript, which the server correctly
answers with (almost) nothing — a permanently empty chat that no page reload can
repair.

A non-descended buffer SHALL be skipped silently on persist. The client SHALL NOT
delete the existing stored entry in that case, because the store is shared across
tabs while buffers are per-tab, and a tab that merely observed a broadcast MUST
NOT destroy another tab's valid cursor.

#### Scenario: Broadcast-only buffer is never persisted as a cursor

- **GIVEN** a client that has never opened, rehydrated, or seeded session X
- **WHEN** it receives one or more live `event` frames for session X by broadcast
  and a persist flush is triggered
- **THEN** the client SHALL NOT write a cache entry for session X
- **AND** the next load of session X SHALL subscribe with `lastSeq: 0` (full
  replay)

#### Scenario: A broadcast observer does not destroy another tab's entry

- **GIVEN** a stored, descended cache entry for session X written by tab A
- **AND** tab B has never opened session X but receives broadcast events for it
- **WHEN** tab B's persist flush runs and finds its buffer non-descended
- **THEN** the stored entry written by tab A SHALL remain intact
- **AND** tab A SHALL still delta-replay on its next load

#### Scenario: A replay-established buffer still persists and delta-replays

- **GIVEN** a session whose buffer was established by a rehydrate hit or by an
  `event_replay` batch
- **WHEN** live events are appended and a persist flush runs
- **THEN** the client SHALL persist the entry with its derived `maxSeq`
- **AND** the next load SHALL delta-subscribe with that cursor, unchanged from
  current behaviour

#### Scenario: A cold replay starting past seq 1 still establishes provenance

- **GIVEN** a cold subscribe (`lastSeq: 0`) for a session whose replay was
  compacted or capped, so its first batch begins at `seq > 1` and the client's
  state-reset rule does not fire
- **WHEN** the batch is recorded and a persist flush runs
- **THEN** the buffer SHALL be treated as descended
- **AND** the entry SHALL be persisted so the next load delta-replays
- **AND** the client SHALL NOT be forced into a permanent full replay for that
  session

### Requirement: A live-path sequence gap SHALL void the cursor

The client SHALL treat a sequence gap observed on the **live** `event` path as
evidence that its buffer no longer represents a contiguous tail, and SHALL stop
persisting that session's buffer as a cursor until it is re-established by a
seeding operation.

Live frames are contiguous by construction, so a gap means a frame was lost (for
example dropped under WebSocket back-pressure). A cursor derived from a buffer
with a hole would silently skip the lost events forever.

This rule SHALL NOT be applied to gaps observed inside `event_replay` batches:
replay compaction legitimately drops events without rewriting sequence numbers, so
a replay-path gap is not evidence of loss.

#### Scenario: A dropped live frame voids the cursor

- **GIVEN** a session with a descended buffer whose highest seq is N
- **WHEN** the next live `event` for that session arrives with seq greater than
  N+1
- **THEN** the client SHALL mark the buffer non-descended
- **AND** SHALL NOT persist it on subsequent flushes
- **AND** the next load SHALL full-replay (`lastSeq: 0`)

#### Scenario: A compaction gap in a replay batch is tolerated

- **GIVEN** an `event_replay` batch whose events contain non-contiguous sequence
  numbers because the server compacted the replay
- **WHEN** the client seeds or records that batch
- **THEN** the buffer SHALL remain descended
- **AND** the entry SHALL still be persisted and used as a cursor

### Requirement: Only a wholesale reseed SHALL restore provenance to a contaminated buffer

A buffer is **contaminated** once it holds live content the client cannot vouch
for — a live event appended while the buffer was not descended, or a hole left by
a dropped live frame. A recorded `event_replay` batch SHALL NOT restore
provenance to a contaminated buffer; only a seeding operation, which replaces the
buffer wholesale, SHALL clear contamination.

Recording dedups by sequence number, so replayed events at or below the buffered
maximum are discarded. A replay batch may therefore leave a contaminated buffer
byte-for-byte unchanged while appearing to authorize it — re-persisting exactly
the partial-payload cursor this capability exists to prevent.

#### Scenario: A replay batch does not re-authorize a live-contaminated buffer

- **GIVEN** a buffer holding only a stray broadcast event at seq N
- **WHEN** a compacted `event_replay` batch whose events are all at or below seq
  N is recorded, and a persist flush runs
- **THEN** every replayed event SHALL be discarded as already-seen
- **AND** the buffer SHALL remain non-descended
- **AND** the entry SHALL NOT be persisted

#### Scenario: A replay batch does not restore provenance across a live gap

- **GIVEN** a descended buffer whose provenance was voided by a dropped live
  frame
- **WHEN** a later `event_replay` batch appends events above the hole and a
  persist flush runs
- **THEN** the buffer SHALL remain non-descended
- **AND** the entry SHALL NOT be persisted
- **AND** only a subsequent seeding operation SHALL make it persistable again

### Requirement: Pre-change cache entries SHALL be purged once on upgrade

Cache entries written before this change carry no provenance marker, so the client
cannot distinguish a descended entry from a poisoned one. The client SHALL
invalidate every such entry exactly once, via the existing schema-version
mismatch path, so an already-poisoned browser self-heals on first load without any
user action (no storage clearing, no re-pairing, no server restart).

#### Scenario: A poisoned pre-change entry self-heals on upgrade

- **GIVEN** a browser holding a pre-change cache entry whose payload is a single
  stray broadcast event with a high `maxSeq`
- **WHEN** the user loads the upgraded client and opens that session
- **THEN** the stale entry SHALL be discarded as a schema mismatch
- **AND** the client SHALL subscribe with `lastSeq: 0`
- **AND** the full transcript SHALL render

### Requirement: A user-initiated chat refresh SHALL invalidate the durable entry

When the user invokes the per-session chat refresh action, the client SHALL
delete that session's durable cache entry in addition to resetting its in-memory
chat state and replay cursor.

The refresh action already resets every in-memory layer and resubscribes with
`lastSeq: 0` to force a full replay. Leaving the durable entry behind makes the
reset non-durable: the refreshed view is correct only until the next page load,
at which point rehydration serves the same stale entry the user just asked the
client to discard. Because the persister is debounced, whether the stale entry
survives is a race between the flush and the reload — so the failure is
intermittent and appears to the user as "refreshing doesn't stick".

Refresh is the escape hatch a user reaches for *because* the chat looks wrong, so
it is precisely the action that must reach the durable layer. Invalidation SHALL
be scoped to the refreshed session; entries for other sessions SHALL remain
intact.

The durable delete SHALL be ordered before the in-memory reset and the
resubscribe. A surviving entry is not inert: rehydration returns the entry's
`maxSeq` as the subscribe cursor, so the server delta-replays only the tail and
the stale state remains the base of the rendered view. Ordering the delete first
means an interruption that stops the handler — a page unload — leaves *both*
layers in their pre-refresh state rather than pairing an in-memory reset with a
surviving durable entry.

#### Scenario: Refresh then reload does not resurrect the old view

- **GIVEN** a session with a stored cache entry
- **WHEN** the user invokes chat refresh
- **AND** reloads the page before any subsequent persist flush completes
- **THEN** the client SHALL find no cache entry for that session
- **AND** SHALL subscribe with `lastSeq: 0` (full replay)
- **AND** the chat SHALL render the server's transcript, not the pre-refresh one

#### Scenario: Refresh leaves other sessions' entries intact

- **GIVEN** stored cache entries for sessions X and Y
- **WHEN** the user invokes chat refresh on session X
- **THEN** the entry for session X SHALL be deleted
- **AND** the entry for session Y SHALL remain intact
- **AND** a later load of session Y SHALL still delta-replay from its cursor

#### Scenario: Refresh still forces a full replay in the current page

- **GIVEN** a session rendering a chat
- **WHEN** the user invokes chat refresh
- **THEN** the client SHALL reset in-memory chat state and the replay cursor
- **AND** SHALL resubscribe with `lastSeq: 0`
- **AND** the resulting view SHALL be unchanged from current behaviour

### Requirement: A durable entry SHALL only be served to the server that produced it

Each durable cache entry SHALL record the server it was written against, and the
client SHALL rehydrate from an entry only when that recorded server matches the
server it is currently connected to. A non-matching entry SHALL be treated as a
cache miss.

A server switch repoints the WebSocket in place rather than navigating, so the
document keeps its origin and a single durable store accumulates entries from
every server the browser has connected to. Before this scoping, entries were
keyed by `sessionId` alone; `sessionId` is not globally unique across servers,
so an entry written against one server was indistinguishable from one written
against another, and a colliding id served the wrong server's history.

Scoping the entry to its server addresses the collision at its cause. It also
removes the need for any switch-time purge: nothing has to be reclaimed, because
nothing foreign is readable in the first place. Entries for the previous server
remain in the store and remain usable if the user switches back, so switching is
not penalised with a full replay in each direction.

That preservation holds per DISTINCT session id. The durable record is still
identified by `sessionId` alone, so when the same id exists on two servers the
later write replaces the earlier server's record and switching back to that
server full-replays that one session. This is a hit-rate cost only — the
recorded-server check still governs what may be READ, so a replaced or foreign
record can never serve the wrong server's history. Identifying the record by
server AND session id would preserve both copies; it is not required for
correctness and is left to a follow-up.

The recorded server identity SHALL be derived from information the client
already has, and SHALL NOT require a protocol change, a server change, or a new
message type. Such an identity distinguishes servers by network location rather
than by instance, so two servers that successively occupy the same location — a
reused port, a repointed tunnel, a replaced container — are not distinguished.
That case is out of scope: it is narrowed but not closed by this requirement, and
closing it requires a server-generated identity on the wire.

The in-memory replay buffers accumulated against the previous server SHALL be
discarded on a switch, so that no buffered content from the previous server can
be persisted under the new server's identity.

#### Scenario: An entry written on one server is not served on another

- **GIVEN** a stored entry for session id S written while connected to server A
- **WHEN** the client is connected to server B and session S is opened
- **THEN** the client SHALL NOT rehydrate session S from that entry
- **AND** SHALL subscribe with `lastSeq: 0`
- **AND** the chat SHALL render only server B's transcript for S

#### Scenario: Switching back to the previous server still delta-replays

- **GIVEN** a client that has switched from server A to server B
- **AND** a stored entry for a server-A session whose id was not opened on B
- **WHEN** the user switches back to server A and opens that session
- **THEN** the client SHALL rehydrate from the stored entry
- **AND** SHALL subscribe with that entry's cursor rather than `lastSeq: 0`

#### Scenario: Buffered content from the previous server is not persisted

- **GIVEN** a client connected to server A with buffered, unflushed replay
  content for its sessions
- **WHEN** the user switches to server B
- **THEN** no entry attributed to server B SHALL contain content produced by
  server A

#### Scenario: A failed switch leaves stored entries usable

- **GIVEN** a client connected to server A with stored entries
- **WHEN** a switch to server B is attempted and the connection never opens, so
  the live connection to server A is preserved
- **THEN** sessions on server A SHALL still delta-replay from their cursors

#### Scenario: Entries predating server scoping are not served

- **GIVEN** a stored entry written before entries recorded a server identity
- **WHEN** that session is opened
- **THEN** the client SHALL treat the entry as unusable
- **AND** SHALL subscribe with `lastSeq: 0`

### Requirement: An unavailable durable store SHALL NOT impair a chat refresh

When the durable delete performed by a user-initiated chat refresh does not
succeed — an IndexedDB error, or a store that is unavailable entirely, as in
private browsing — the refresh SHALL still reset in-memory chat state, reset the
replay cursor, and resubscribe with `lastSeq: 0`. No error SHALL be surfaced to
the user.

The durable delete is part of the refresh, not a precondition for it. A refresh
that silently did nothing because the cache layer was unavailable would break the
user's only escape hatch in exactly the environments where the cache is least
able to cause the problem being escaped.

#### Scenario: An unavailable durable store does not break refresh

- **GIVEN** a browsing context where IndexedDB is unavailable
- **WHEN** the user invokes chat refresh
- **THEN** the refresh SHALL reset in-memory state and resubscribe with
  `lastSeq: 0`
- **AND** no error SHALL be surfaced to the user

