## Purpose

Defines how the dashboard server delivers frames to a browser WebSocket under back-pressure: which frame classes may be shed, which are deferred and coalesced, the memory bounds that hold on a stalled socket, and the order of the connect bootstrap so that small idempotent state never queues behind a large registry frame.

## ADDED Requirements

### Requirement: Every server-to-browser frame has a delivery class

Every frame the server sends to a browser SHALL belong to exactly one delivery class: `transcript` (per-session event stream, recoverable via history backfill or replay), `blocking` (a pending-prompt frame governed by the pending-prompt-recovery exemption), or `state` (an idempotent snapshot of server-held state identified by a `(type, entityKey)` key). A frame's class SHALL be fixed by its message type and SHALL NOT depend on socket condition.

#### Scenario: Connect-bootstrap frames are state-class
- **WHEN** the server emits any of `pinned_dirs_updated`, `workspaces_updated`, `favorite_models_updated`, `display_prefs_updated`, `reachability_updated`, `openspec_update`, `openspec_get_result`, `git_head_update`, `terminal_added`, `terminal_updated`, `terminal_removed`, `sessions_page_result`, or `sessions_snapshot`
- **THEN** the frame SHALL be delivered under the `state` class

#### Scenario: Entity-keyed state frames share a key per entity
- **WHEN** two `state` frames of the same type refer to the same entity (the same `cwd` for `openspec_update` / `git_head_update` / `sessions_page_result`, the same terminal id for `terminal_added` / `terminal_updated` / `terminal_removed`)
- **THEN** they SHALL resolve to the same delivery key
- **AND** `terminal_added`, `terminal_updated`, and `terminal_removed` for one terminal id SHALL resolve to one shared key so that a later lifecycle frame supersedes an earlier one

#### Scenario: Session event frames are transcript-class
- **WHEN** the server sends a per-session event frame or a session-registry broadcast (`session_updated`, `sessions_reordered`, `session_added`, `session_removed`)
- **THEN** the frame SHALL be delivered under the `transcript` class, subject to the back-pressure shed as before this change

### Requirement: Transcript frames are shed above the threshold, state frames are never shed

When a browser socket's buffered amount exceeds the back-pressure threshold, the server SHALL drop `transcript` frames (counted, as before) and SHALL NOT drop `state` frames. A `state` frame that cannot be sent immediately SHALL be deferred in a per-socket pending map keyed by its delivery key, where a newer frame for the same key replaces the older one. Deferred frames SHALL be flushed in key-insertion order once the socket's buffered amount falls back under the threshold. The flush SHALL be triggered both by send completion and by a periodic check while the pending map is non-empty, so a socket that drains without further sends still flushes.

#### Scenario: State frame survives a saturated socket
- **GIVEN** a browser socket whose buffered amount exceeds the threshold
- **WHEN** the server has an `openspec_update` for cwd `/repo/a` to deliver to it
- **THEN** the frame SHALL NOT be counted as dropped
- **AND** after the socket drains below the threshold the browser SHALL receive an `openspec_update` for `/repo/a`

#### Scenario: Newer state frame supersedes an older pending one
- **GIVEN** a saturated socket with a pending `openspec_update` for `/repo/a`
- **WHEN** a newer `openspec_update` for `/repo/a` arrives before the flush
- **THEN** only the newer payload SHALL be delivered on flush
- **AND** the superseded entry SHALL be counted under `coalescedState`

#### Scenario: Pending map flushes without a subsequent send
- **GIVEN** a saturated socket with pending state frames
- **WHEN** the socket drains below the threshold and no further frame is sent to it
- **THEN** the pending frames SHALL still be delivered within the periodic flush interval

#### Scenario: Transcript frame is still shed
- **WHEN** a socket's buffered amount exceeds the threshold
- **AND** the server has a transcript-class frame for it
- **THEN** the frame SHALL be dropped and counted under the transcript-frame counter, as before

### Requirement: Memory on a stalled socket is bounded

The per-socket pending map SHALL hold at most one frame per delivery key and its total serialized bytes SHALL NOT exceed the back-pressure threshold. When deferring a frame would exceed that byte ceiling, the server SHALL terminate the socket as stalled (counted under `stalledSocketsTerminated`) rather than grow the map; the browser's existing reconnect path then rebuilds state from a fresh bootstrap. A socket that closes for any reason SHALL discard its pending map. The blocking-frame exemption bounds defined in `pending-prompt-recovery` are unchanged; `state` frames are deferred, never exempt, so the absolute ceiling above which no frame is exempt continues to hold.

#### Scenario: Pending map byte ceiling terminates a stalled socket
- **GIVEN** a socket that never drains and a pending map at the byte ceiling
- **WHEN** another state frame must be deferred for it
- **THEN** the server SHALL close that socket
- **AND** `stalledSocketsTerminated` SHALL increment
- **AND** the server's retained bytes for that socket SHALL be released

#### Scenario: One entry per key regardless of frame count
- **GIVEN** a saturated socket
- **WHEN** 100 `git_head_update` frames for the same cwd are deferred
- **THEN** the pending map SHALL hold exactly one entry for that key

#### Scenario: Blocking exemption unchanged
- **WHEN** a pending-prompt frame is delivered to a saturated socket
- **THEN** it SHALL be governed by the existing 4-frames-per-delivery maximum and `MAX_WS_BUFFER` + 1 MB ceiling exactly as specified in `pending-prompt-recovery`

### Requirement: Connect bootstrap emits state frames before the sessions snapshot

On a browser connect, the server SHALL emit every connect-bootstrap `state` frame other than `sessions_snapshot` before it emits `sessions_snapshot`, and `sessions_snapshot` SHALL be the last frame of the bootstrap. This ordering SHALL NOT place any session-registry send ahead of `sessions_snapshot`.

#### Scenario: Openspec state precedes the snapshot
- **WHEN** a browser connects while the server knows N cwds
- **THEN** the browser SHALL receive N `openspec_update` frames before it receives `sessions_snapshot`

#### Scenario: Snapshot is last
- **WHEN** a browser connects
- **THEN** no connect-bootstrap frame SHALL be sent after `sessions_snapshot` on that socket

#### Scenario: Registry invariant preserved
- **WHEN** a browser connects
- **THEN** no `session_added`, `session_updated`, `session_removed`, or `sessions_reordered` SHALL be sent on that socket before `sessions_snapshot`

### Requirement: Health exposes per-class delivery counters

The health endpoint SHALL report, under `droppedFrames`, the existing transcript and blocking drop counters plus `coalescedState` (count of pending state entries superseded before flush) and `stalledSocketsTerminated`. There SHALL be no counter for dropped state frames because no code path drops one.

#### Scenario: Counters present on health
- **WHEN** `/api/health` is fetched
- **THEN** `droppedFrames.coalescedState` and `droppedFrames.stalledSocketsTerminated` SHALL be numeric fields

#### Scenario: Coalesce is not a drop
- **WHEN** a pending state entry is superseded
- **THEN** `droppedFrames.serverToBrowser.total` SHALL NOT increment
- **AND** `droppedFrames.coalescedState` SHALL increment
