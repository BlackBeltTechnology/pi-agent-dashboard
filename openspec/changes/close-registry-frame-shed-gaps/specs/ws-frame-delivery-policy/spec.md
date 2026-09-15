## MODIFIED Requirements

### Requirement: Every server-to-browser frame has a delivery class

Every frame the server sends to a browser SHALL belong to exactly one delivery class: `transcript` (per-session event stream, recoverable via history backfill or replay), `blocking` (a pending-prompt frame governed by the pending-prompt-recovery exemption), or `state` (an idempotent snapshot of server-held state identified by a `(type, entityKey)` key). `sessions_reordered` is `state`-class: it is a window-projected FULL per-cwd ordering snapshot, so the latest frame per cwd is the whole truth. A frame's class SHALL be fixed by its message type and SHALL NOT depend on socket condition.

#### Scenario: Connect-bootstrap frames are state-class
- **WHEN** the server emits any of `pinned_dirs_updated`, `workspaces_updated`, `favorite_models_updated`, `display_prefs_updated`, `reachability_updated`, `openspec_update`, `openspec_get_result`, `git_head_update`, `terminal_added`, `terminal_updated`, `terminal_removed`, `sessions_page_result`, `sessions_reordered`, or `sessions_snapshot`
- **THEN** the frame SHALL be delivered under the `state` class

#### Scenario: Entity-keyed state frames share a key per entity
- **WHEN** two `state` frames of the same type refer to the same entity (the same `cwd` for `openspec_update` / `git_head_update` / `sessions_page_result` / `sessions_reordered`, the same terminal id for `terminal_added` / `terminal_updated` / `terminal_removed`)
- **THEN** they SHALL resolve to the same delivery key
- **AND** `terminal_added`, `terminal_updated`, and `terminal_removed` for one terminal id SHALL resolve to one shared key so that a later lifecycle frame supersedes an earlier one

#### Scenario: Session event frames are transcript-class
- **WHEN** the server sends a per-session event frame or a session-registry broadcast (`session_updated`, `session_added`, `session_removed`)
- **THEN** the frame SHALL be delivered under the `transcript` class, subject to the back-pressure shed; a shed registry broadcast is recovered by the reconcile debt (see "A shed session-registry frame SHALL be reconciled from current state")

#### Scenario: A reorder deferred under back-pressure is delivered latest-wins
- **GIVEN** a socket above the threshold
- **WHEN** three `sessions_reordered` frames for `/repoA` and one for `/repoB` are broadcast
- **THEN** none SHALL be shed
- **AND** on drain the socket SHALL receive exactly one `sessions_reordered` for `/repoA` carrying the last ordering and one for `/repoB`

## REMOVED Requirements

### Requirement: A shed session_updated SHALL be reconciled from current state
**Reason**: Widened to every session-registry broadcast; re-stated under a name that does not encode `session_updated` alone.
**Migration**: Every clause carries over into "A shed session-registry frame SHALL be reconciled from current state"; `session_updated` behaviour is unchanged.

## ADDED Requirements

### Requirement: A shed session-registry frame SHALL be reconciled from current state

Dropping a session-registry frame (`session_updated`, `session_added`, `session_removed`) is unbounded-stale: the frame carries no
sequence number, no backfill request answers it, and no later frame is
guaranteed to supersede it — a session that changes status once and then runs
for minutes (a long tool call) leaves the browser showing the pre-change value
until a reconnect. The server SHALL therefore treat a shed registry frame as
a debt owed to that socket.

When a `session_updated`, `session_added`, or `session_removed` frame is dropped for a browser socket under
back-pressure, the server SHALL record the affected session id for that socket together with the
strongest owed kind for that id (`removed` over `added` over `updated`) and, for an owed `added`, the
`spawnRequestId` the shed frame carried, if any. Within 1 second of the socket's buffered amount
falling back under the threshold, the server SHALL send that socket a frame rebuilt from the session's
CURRENT server-held state: `session_removed` when the session no longer exists (whatever kind was owed);
`session_added` carrying the full current record and the recorded `spawnRequestId` when `added` is owed;
otherwise `session_updated` carrying the current `status` and `currentTool`. The recorded set SHALL hold
identifiers, a kind tag, and at most one short correlation id per entry — never a queued payload —
so it cannot contribute to the pending-state byte ceiling or to
`stalledSocketsTerminated`.

The reconcile SHALL be self-healing: a reconcile frame that is itself shed SHALL
re-record the session id, so delivery is eventually-consistent rather than
attempted once. The reconcile SHALL carry the CURRENT value, not the shed one;
an intermediate transition that was shed within a single flood window is NOT
recovered, and only the settled value is guaranteed.

The recorded set and any timer serving it SHALL be released when the socket
closes, errors, or is terminated as stalled.

`sessions_reordered` is `state`-class and is never shed, so it needs no debt.

#### Scenario: A shed status frame is redelivered after the socket drains

- **GIVEN** a browser socket whose buffered amount exceeds the threshold
- **AND** a session whose status changes to `streaming`
- **WHEN** the `session_updated` carrying that status is dropped for that socket
- **AND** the socket later drains below the threshold with no further status change
- **THEN** that socket SHALL receive a `session_updated` for that session within 1 second
- **AND** the frame SHALL carry the session's current `status` and `currentTool`

#### Scenario: A stale status does not survive a quiet flood window

- **GIVEN** a session shown as `idle` by a browser
- **AND** the server's state for it is `streaming` because its status frame was shed
- **WHEN** no further status change occurs for 60 seconds
- **THEN** the browser SHALL NOT still be showing `idle` once its socket has
  drained below the threshold

#### Scenario: A shed reconcile is retried, not lost

- **GIVEN** a socket with a recorded shed `session_updated`
- **WHEN** the reconcile frame is itself dropped because the socket re-crossed
  the threshold
- **THEN** the session id SHALL remain (or be re-recorded) as owed for that socket
- **AND** a later reconcile SHALL deliver it once the socket stays under the threshold

#### Scenario: Only the settled value is guaranteed

- **GIVEN** a socket above the threshold
- **WHEN** a session transitions `idle` → `streaming` → `idle` entirely within
  the window during which its frames are shed
- **THEN** the reconcile SHALL deliver `idle`
- **AND** the intermediate `streaming` value SHALL NOT be required to arrive

#### Scenario: The reconcile record costs no pending bytes

- **GIVEN** a socket that has shed status frames for 100 distinct sessions
- **WHEN** the server's retained state for that socket is measured
- **THEN** the reconcile record SHALL hold identifiers only
- **AND** `stalledSocketsTerminated` SHALL NOT increment as a result of them

#### Scenario: A reconcile never resurrects a removed session

- **GIVEN** a browser that no longer holds a row for a session
- **WHEN** a reconcile `session_updated` for that session arrives
- **THEN** the browser SHALL NOT create a row for it

#### Scenario: Socket teardown releases the record

- **GIVEN** a socket with recorded shed status frames and an active reconcile timer
- **WHEN** the socket closes, errors, or is terminated as stalled
- **THEN** the record and the timer SHALL be released


#### Scenario: A shed session_added is redelivered as a full record

- **GIVEN** a socket above the threshold
- **WHEN** a `session_added` for session `s1` (with `spawnRequestId: "r1"`) is dropped for that socket
- **AND** the socket later drains below the threshold while `s1` still exists
- **THEN** that socket SHALL receive a `session_added` for `s1` within 1 second carrying the session's current full record and `spawnRequestId: "r1"`

#### Scenario: A shed session_removed converges to removed

- **WHEN** a `session_removed` for `s2` is dropped for a socket
- **AND** the socket drains while `s2` no longer exists
- **THEN** that socket SHALL receive a `session_removed` for `s2`

#### Scenario: Add then remove within one window converges to removed

- **WHEN** `session_added` and then `session_removed` for `s3` are both dropped for a socket within one flood window
- **THEN** on drain the socket SHALL receive only `session_removed` for `s3`

#### Scenario: Remove then re-add converges to the current record

- **WHEN** `session_removed` for `s4` is dropped and `s4` is later re-registered and its `session_added` is also dropped
- **THEN** on drain the socket SHALL receive a `session_added` for `s4` carrying the current record

#### Scenario: A reconciled add is an upsert on the client

- **GIVEN** a browser that already holds a row for `s5`
- **WHEN** a reconcile `session_added` for `s5` arrives
- **THEN** the browser SHALL replace the row's server-held fields and SHALL NOT duplicate the row
