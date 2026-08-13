## ADDED Requirements

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
every server the browser has connected to. Entries are keyed by `sessionId`
alone, and `sessionId` is not globally unique across servers — so today an entry
written against one server is indistinguishable from an entry written against
another, and a colliding id serves the wrong server's history.

Scoping the entry to its server addresses the collision at its cause. It also
removes the need for any switch-time purge: nothing has to be reclaimed, because
nothing foreign is readable in the first place. Entries for the previous server
remain in the store and remain usable if the user switches back, so switching is
not penalised with a full replay in each direction.

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
