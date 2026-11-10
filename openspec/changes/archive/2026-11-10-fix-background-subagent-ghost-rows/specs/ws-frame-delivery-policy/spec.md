# Spec Delta

## MODIFIED Requirements

### Requirement: Every server-to-browser frame has a delivery class

Every frame the server sends to a browser SHALL belong to exactly one delivery class: `transcript` (per-session event stream, recoverable via history backfill or replay), `blocking` (a pending-prompt frame governed by the pending-prompt-recovery exemption), or `state` (a frame that must not be lost, identified by a `(type, entityKey)` key, where a newer frame for the same key supersedes an older one). `sessions_reordered` is `state`-class: it is a window-projected FULL per-cwd ordering snapshot, so the latest frame per cwd is the whole truth. A per-session event frame whose event ends a subagent (`subagent_completed`, `subagent_failed`) or reports subagent liveness (`subagent_stop_result`, `subagent_registry_snapshot`) is `transcript`-class with a defer key: it is sent like any transcript frame, but where a transcript frame would be shed it SHALL be deferred as a `state` frame under that key instead. A frame's class and defer key SHALL be fixed by its message type and, for a per-session event frame, its event type; they SHALL NOT depend on socket condition.

#### Scenario: Connect-bootstrap frames are state-class
- **WHEN** the server emits any of `pinned_dirs_updated`, `workspaces_updated`, `favorite_models_updated`, `display_prefs_updated`, `reachability_updated`, `openspec_update`, `openspec_get_result`, `git_head_update`, `terminal_added`, `terminal_updated`, `terminal_removed`, `sessions_page_result`, `sessions_reordered`, or `sessions_snapshot`
- **THEN** the frame SHALL be delivered under the `state` class

#### Scenario: Entity-keyed state frames share a key per entity
- **WHEN** two `state` frames of the same type refer to the same entity (the same `cwd` for `openspec_update` / `git_head_update` / `sessions_page_result` / `sessions_reordered`, the same terminal id for `terminal_added` / `terminal_updated` / `terminal_removed`)
- **THEN** they SHALL resolve to the same delivery key
- **AND** `terminal_added`, `terminal_updated`, and `terminal_removed` for one terminal id SHALL resolve to one shared key so that a later lifecycle frame supersedes an earlier one

#### Scenario: Session event frames are transcript-class
- **WHEN** the server sends a per-session event frame whose event is not a subagent end or subagent liveness frame, or a session-registry broadcast (`session_updated`, `session_added`, `session_removed`)
- **THEN** the frame SHALL be delivered under the `transcript` class, subject to the back-pressure shed; a shed registry broadcast is recovered by the reconcile debt (see "A shed session-registry frame SHALL be reconciled from current state")

#### Scenario: Subagent end frame has a per-subagent defer key
- **WHEN** the server sends a per-session event frame for session S whose event is `subagent_completed` or `subagent_failed` for agent A
- **THEN** the frame SHALL carry a defer key unique to S and A, different for a server-synthesized heal than for a real end

#### Scenario: Subagent end without an id has no defer key
- **WHEN** a `subagent_completed` event frame carries no string `id`
- **THEN** the frame SHALL have no defer key and SHALL be shed like any transcript frame

#### Scenario: Subagent liveness frames have defer keys
- **WHEN** the server sends a per-session event frame for session S whose event is `subagent_stop_result` for agent A, or `subagent_registry_snapshot`
- **THEN** the stop answer SHALL carry a defer key unique to S and A and different from A's end key, and the snapshot a defer key unique to S

#### Scenario: A stop answer never replaces an end
- **GIVEN** a saturated socket with A's `subagent_completed` pending
- **WHEN** A's `subagent_stop_result` is sent to it
- **THEN** on drain the browser SHALL receive both frames

#### Scenario: A reorder deferred under back-pressure is delivered latest-wins
- **GIVEN** a socket above the threshold
- **WHEN** three `sessions_reordered` frames for `/repoA` and one for `/repoB` are broadcast
- **THEN** none SHALL be shed
- **AND** on drain the socket SHALL receive exactly one `sessions_reordered` for `/repoA` carrying the last ordering and one for `/repoB`

### Requirement: Health exposes per-class delivery counters

The health endpoint SHALL report, under `droppedFrames`, the existing transcript
and blocking drop counters plus `coalescedState` (count of pending state entries
superseded before flush) and `stalledSocketsTerminated`. There SHALL be no
counter for dropped state frames because no code path drops one.

The endpoint SHALL additionally report the status-reconcile counters: the number
of session ids recorded as owed after a shed `session_updated`, and the number of
reconcile frames sent. Both SHALL be numeric and SHALL be present before any
reconcile has occurred. It SHALL also report `deferredSubagentFrames`, the number of
subagent end and liveness frames deferred instead of shed; it SHALL be numeric and
present before any deferral has occurred.

#### Scenario: Counters present on health

- **WHEN** `/api/health` is fetched
- **THEN** `droppedFrames.coalescedState` and `droppedFrames.stalledSocketsTerminated` SHALL be numeric fields

#### Scenario: Coalesce is not a drop

- **WHEN** a pending state entry is superseded
- **THEN** `droppedFrames.serverToBrowser.total` SHALL NOT increment
- **AND** `droppedFrames.coalescedState` SHALL increment

#### Scenario: Reconcile counters present on health

- **WHEN** `/api/health` is fetched
- **THEN** the status-reconcile queued and sent counters SHALL be numeric fields

#### Scenario: A shed status frame increments the queued counter

- **WHEN** a `session_updated` is dropped for a saturated socket
- **THEN** the reconcile queued counter SHALL increment
- **AND** `droppedFrames.serverToBrowser.total` SHALL also increment, because the
  frame was still a drop

#### Scenario: A deferred subagent frame is counted, not dropped

- **WHEN** a subagent end frame is deferred for a saturated socket
- **THEN** `deferredSubagentFrames` SHALL increment
- **AND** `droppedFrames.serverToBrowser.total` SHALL NOT increment

## ADDED Requirements

### Requirement: A deferred subagent end SHALL survive a saturated socket

A subagent end or liveness frame that cannot be sent immediately SHALL be deferred in the socket's pending map like any other `state` frame and SHALL NOT be counted as a dropped frame. When it is delivered, the client SHALL show the subagent as ended exactly as if the frame had arrived live.

#### Scenario: Subagent end survives a flood
- **GIVEN** a browser socket above the back-pressure threshold
- **WHEN** background subagent A's `subagent_completed` is sent to it
- **THEN** the frame SHALL NOT be counted as dropped, and SHALL be counted as a deferred subagent frame
- **AND** after the socket drains, the browser SHALL receive A's end and A SHALL leave the Processes lane

#### Scenario: Ten ends during a flood
- **GIVEN** a saturated socket
- **WHEN** ten background subagents end while it stays saturated
- **THEN** on drain the browser SHALL receive all ten ends, one per subagent

### Requirement: A deferred subagent end SHALL be bounded in size

A subagent end sent while the socket is under the threshold SHALL be the full frame. Only the deferred copy SHALL be bounded: it keeps the id, status, error, stop reason, duration, token and tool-use counts and a cut result, and omits the timeline entries. The client SHALL keep its timeline and SHALL NOT cache the bounded copy. The forwarded and stored frames keep the full timeline (`subagent-details-payload`).

#### Scenario: Deferred end frame is bounded
- **GIVEN** a saturated socket
- **WHEN** A's `subagent_completed` carries a 2 MB timeline in its details
- **THEN** the pending copy SHALL omit the timeline entries and SHALL be no larger than the bounded projection

#### Scenario: Healthy socket gets the full end frame
- **GIVEN** a socket under the threshold
- **WHEN** A's `subagent_completed` with its timeline is sent
- **THEN** the browser receives the full frame, unchanged from before this change

#### Scenario: Bounded copy is not cached
- **WHEN** the browser receives a deferred, bounded end frame for A
- **THEN** its replay cache does not store that frame, and the next load of the session replays A's full end from the server

#### Scenario: Timeline kept after a deferred end
- **GIVEN** the browser shows 40 timeline steps for running subagent A
- **WHEN** A's deferred, projected `subagent_completed` is delivered
- **THEN** A is `completed` and its full-screen view still shows the 40 steps
