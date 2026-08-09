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

### Requirement: Switching servers SHALL invalidate every durable entry

When the client switches to a different dashboard server, it SHALL clear the
entire durable replay cache.

A server switch repoints the WebSocket in place rather than navigating, so the
document keeps its origin and a single IndexedDB accumulates entries from every
server the browser has connected to. Entries are keyed by `sessionId` alone and
carry no server identity, so entries belonging to different servers are
indistinguishable in the store.

The in-memory reset performed on switch already discards the session registry,
per-session chat state, replay cursors, and rehydration guards — the durable
layer SHALL be reset with them, so no state from the previous server outlives the
switch at any layer.

Clearing the whole store is intentional rather than selective: with no server
identity in the entry, selective invalidation is not expressible. The cost is one
full replay per session after a switch, which the capability's "optimization
only" contract already permits.

#### Scenario: Entries from the previous server do not survive a switch

- **GIVEN** a client connected to server A with stored entries for its sessions
- **WHEN** the user switches to server B
- **THEN** the durable cache SHALL contain no entries
- **AND** sessions opened on server B SHALL subscribe with `lastSeq: 0`

#### Scenario: A colliding session id cannot serve the wrong server's history

- **GIVEN** a stored entry for session id S written while connected to server A
- **WHEN** the user switches to server B, which also has a session with id S
- **THEN** the client SHALL NOT rehydrate session S from the stored entry
- **AND** SHALL subscribe with `lastSeq: 0`
- **AND** the chat SHALL render only server B's transcript for S

#### Scenario: A failed switch leaves the cache untouched

- **GIVEN** a client connected to server A with stored entries
- **WHEN** a switch to server B is attempted and the connection never opens, so
  the live connection to server A is preserved
- **THEN** the durable cache SHALL NOT be cleared
- **AND** sessions on server A SHALL still delta-replay from their cursors
