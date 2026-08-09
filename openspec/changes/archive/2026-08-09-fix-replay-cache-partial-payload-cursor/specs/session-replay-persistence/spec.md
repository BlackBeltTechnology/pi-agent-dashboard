## ADDED Requirements

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
