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

