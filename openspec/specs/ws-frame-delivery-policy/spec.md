# ws-frame-delivery-policy Specification

## Purpose
Defines how the dashboard server delivers frames to a browser WebSocket under back-pressure: which frame classes may be shed, which are deferred and coalesced, the memory bounds that hold on a stalled socket, and the order of the connect bootstrap so that small idempotent state never queues behind a large registry frame.

## Requirements

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

The health endpoint SHALL report, under `droppedFrames`, the existing transcript
and blocking drop counters plus `coalescedState` (count of pending state entries
superseded before flush) and `stalledSocketsTerminated`. There SHALL be no
counter for dropped state frames because no code path drops one.

The endpoint SHALL additionally report the status-reconcile counters: the number
of session ids recorded as owed after a shed `session_updated`, and the number of
reconcile frames sent. Both SHALL be numeric and SHALL be present before any
reconcile has occurred.

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

### Requirement: Socket buffer occupancy SHALL be observable

Back-pressure incidents are currently diagnosable only by inference from
cumulative, instance-wide drop counters, which cannot attribute saturation to a
socket or bound its duration. The health endpoint SHALL expose per-browser-socket
buffered-amount occupancy — the observed maximum, the p95, and the cumulative
milliseconds spent above the threshold since boot — so a saturation claim can be
measured rather than inferred.

These values are **observation-based, not continuous wall-clock**. Occupancy is
sampled when the server makes a send decision for a socket, so a crossing that
begins and ends entirely between two such decisions is not observed, and a
reported duration is bounded by the samples that delimit it. The metric SHALL
NOT report an unbounded duration for a socket that has drained: a span whose
socket is no longer above the threshold SHALL be settled at its next reading
rather than continuing to accrue.

#### Scenario: Occupancy is reported

- **WHEN** `/api/health` is fetched while at least one browser socket is connected
- **THEN** the response SHALL report buffered-amount occupancy for browser sockets
- **AND** the reported values SHALL include `max`, `p95`, and cumulative
  milliseconds above the threshold, each derived from observed samples

#### Scenario: A drained socket stops accruing duration

- **GIVEN** a socket observed above the threshold
- **WHEN** it drains below the threshold without a further send decision
- **AND** `/api/health` is fetched repeatedly
- **THEN** the reported cumulative milliseconds SHALL NOT grow with each fetch

#### Scenario: Occupancy is reported without a saturation event

- **WHEN** `/api/health` is fetched on an instance that has never crossed the threshold
- **THEN** the occupancy fields SHALL be present and numeric

### Requirement: A shed session-registry frame SHALL be reconciled from current state

Dropping a session-registry frame (`session_updated`, `session_added`, `session_removed`) is unbounded-stale: the frame carries no
sequence number, no backfill request answers it, and no later frame is
guaranteed to supersede it — a session that changes status once and then runs
for minutes (a long tool call) leaves the browser showing the pre-change value
until a reconnect. The server SHALL therefore treat a shed registry frame as
a debt owed to that socket.

When a `session_updated`, `session_added`, or `session_removed` frame is dropped for a browser socket under
back-pressure, the server SHALL record the affected session id for that socket together with the
owed kind for that id, for an owed `added` the `spawnRequestId` the shed frame carried, if any, and a flag
recording whether a `session_added` for that id was shed at any point while the debt was outstanding. That
flag SHALL persist even after the owed kind is superseded by `removed`.
The recorded kind SHALL follow last-write-wins across the lifecycle kinds — a newly recorded `added` or
`removed` SHALL overwrite any kind already recorded for that id, while a newly recorded `updated` SHALL
overwrite only an existing `updated` and SHALL NOT downgrade a pending `added` or `removed`.

A lifecycle frame that is DELIVERED successfully to a socket SHALL clear that socket's recorded debt for
that session id, including the shed-`added` flag, because the delivered frame is that socket's current
truth and any older debt describes a state the socket has already been told about. The clear SHALL NOT
discard debt recorded for that id during or after the send. Without this rule a shed `session_added`
followed by a successfully delivered `session_removed` would leave `added` owed, and the flush would emit
a reconciled `session_added` that resurrects an ended row the socket was correctly told to drop.

Within 1 second of the socket's buffered amount falling back under the threshold, the server SHALL send
that socket a frame rebuilt from the session's CURRENT server-held state, resolved in this order:
when `removed` is owed and no record for that id exists, `session_removed`; when `removed` is owed and the
record is no longer ended, the removal SHALL be treated as superseded by a re-registration and `session_added`
carrying the full current record and `reconciled: true` SHALL be sent instead; when `removed` is owed, the
record is ended, and a `session_added` for that id was also shed while the debt was outstanding, `session_added`
carrying the full current record and `reconciled: true` SHALL be sent, so a session whose creation and ending
were both shed is still presented rather than silently absent; when `removed` is owed and the record is ended
with no shed creation, `session_removed`; otherwise when the session no longer exists, `session_removed`;
otherwise when `added` is owed, `session_added` carrying the full current record, the recorded
`spawnRequestId`, and `reconciled: true`; otherwise `session_updated` carrying the session's current
`status`, `currentTool`, and `hostPressure`. `status` SHALL always carry the session's current status
and SHALL NOT be cleared; `currentTool` and `hostPressure` are the optional fields, each using `null`
(never `undefined`) as its clearing value.

A session record that is no longer ended SHALL be taken to mean the id was registered again, which requires
that registration is the only operation that puts a session record into a non-ended status. The recorded set SHALL hold
identifiers, a kind tag, a boolean flag, and at most one short correlation id per entry — never a queued payload —
so it cannot contribute to the pending-state byte ceiling or to
`stalledSocketsTerminated`.

A `session_added` carrying `reconciled: true` SHALL NOT cause the browser to navigate to that session by any
of its spawn-correlation paths, including those that match on cwd rather than on `spawnRequestId`; the
browser SHALL consume a pending-spawn record and clear a spawning placeholder ONLY on an exact
`spawnRequestId` match, so that a reconciled frame carrying no `spawnRequestId` cannot clear the placeholder
of an unrelated spawn that is pending in the same cwd.

The reconcile SHALL be self-healing: a reconcile frame that is itself shed SHALL
re-record the session id together with the kind that was being sent — for every
reconciled kind, not only `session_updated` — so delivery is eventually-consistent rather than
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
- **THEN** that socket SHALL receive a `session_added` for `s1` within 1 second carrying the session's current full record, `spawnRequestId: "r1"`, and `reconciled: true`

#### Scenario: A shed session_removed converges to removed

- **WHEN** a `session_removed` for `s2` is dropped for a socket
- **AND** the socket drains while `s2` no longer exists
- **THEN** that socket SHALL receive a `session_removed` for `s2`

#### Scenario: A delivered removal clears an older shed-add debt

- **WHEN** a `session_added` for `s10` is dropped for a socket
- **AND** a later `session_removed` for `s10` is delivered to that socket successfully
- **AND** the socket then drains while `s10`'s record is ended
- **THEN** that socket SHALL NOT receive a reconciled `session_added` for `s10`

#### Scenario: Remove then re-add converges to the current record

- **WHEN** `session_removed` for `s4` is dropped and `s4` is later re-registered and its `session_added` is also dropped
- **THEN** on drain the socket SHALL receive a `session_added` for `s4` carrying the current record

#### Scenario: A reconciled add is an upsert on the client

- **GIVEN** a browser that already holds a row for `s5`
- **WHEN** a reconcile `session_added` for `s5` arrives
- **THEN** the browser SHALL replace the row's server-held fields and SHALL NOT duplicate the row
- **AND** the `resuming` flag of any OTHER session in the same cwd SHALL be unchanged

#### Scenario: An owed removal wins when the ended record merely outlives the broadcast

- **GIVEN** a `session_removed` for `s6` was dropped for a socket
- **AND** no `session_added` for `s6` was dropped for that socket
- **AND** an ended record for `s6` is still present in the session manager when the socket drains
- **THEN** that socket SHALL receive a `session_removed` for `s6`
- **AND** SHALL NOT receive a `session_updated` for `s6`

#### Scenario: A re-registered id supersedes an owed removal

- **GIVEN** a `session_removed` for `s8` was dropped for a socket
- **AND** `s8` is registered again before the socket drains, so its record is no longer ended
- **AND** that registration's own `session_added` was ALSO dropped for that socket
- **WHEN** the socket drains
- **THEN** that socket SHALL NOT receive a `session_removed` for `s8`
- **AND** SHALL receive a `session_added` for `s8` carrying the current record and `reconciled: true`

#### Scenario: A delivered re-registration clears the owed removal

- **GIVEN** a `session_removed` for `s8` was dropped for a socket
- **AND** `s8` is registered again before the socket drains, so its record is no longer ended
- **AND** that registration's own `session_added` was DELIVERED to the socket
- **WHEN** the socket drains
- **THEN** that socket SHALL NOT receive a `session_removed` for `s8`
- **AND** SHALL NOT receive any further frame for `s8` — the delivered add is that socket's current truth and cleared the debt

#### Scenario: A session created and ended inside one flood window still appears

- **GIVEN** a socket above the threshold
- **AND** both the `session_added` and the later `session_removed` for `s9` are dropped for that socket
- **WHEN** the socket drains while `s9`'s record is ended
- **THEN** that socket SHALL receive a `session_added` for `s9` carrying the ended record and `reconciled: true`
- **AND** SHALL NOT receive only a `session_removed` for `s9`

#### Scenario: An archived session reconciles as removed

- **GIVEN** a debt is owed for `s10`
- **AND** `s10` is archived before the socket drains, so no record for it remains
- **WHEN** the socket drains
- **THEN** that socket SHALL receive a `session_removed` for `s10`

#### Scenario: No write path revives an ended record implicitly

- **WHEN** the session manager's write paths are enumerated
- **THEN** `unregister`, `remove`, and `restore` SHALL each leave an ended record ended — none of them revives it
- **AND** a session restored from persistence without registering SHALL remain ended
- **AND** a partial `update` carrying an explicit non-ended `status` is the ONLY path that can move a record out of `ended`; the reconcile reads the record's status at FLUSH time, so it delivers whatever status the record actually holds either way

#### Scenario: A reconciled status frame carries the host-pressure clearing value

- **GIVEN** a `session_updated` for `s7` was dropped for a socket
- **AND** `s7` currently has no host pressure
- **WHEN** the socket drains
- **THEN** the reconcile `session_updated` SHALL carry `hostPressure: null` alongside the current `status` and `currentTool`

#### Scenario: A shed reconcile re-records for every kind

- **GIVEN** a reconcile `session_added` and a reconcile `session_removed` are each themselves dropped because the socket is still saturated
- **THEN** each session SHALL remain owed to that socket with its kind intact
- **AND** SHALL be retried on a later drain

#### Scenario: A reconciled add does not steal navigation

- **GIVEN** a browser that issued a spawn with `spawnRequestId: "r2"` and has since navigated to a different session
- **WHEN** a `session_added` carrying `spawnRequestId: "r2"` and `reconciled: true` arrives
- **THEN** the browser SHALL NOT change the displayed session
- **AND** the pending-spawn record for `"r2"` SHALL be consumed
- **AND** the spawning placeholder for that cwd SHALL be cleared

#### Scenario: A reconciled add with no request id touches no spawn state

- **GIVEN** a browser with an unrelated spawn pending for cwd `/repoA`
- **WHEN** a `session_added` for a different `/repoA` session carrying `reconciled: true` and no `spawnRequestId` arrives
- **THEN** the browser SHALL NOT change the displayed session
- **AND** the spawning placeholder for `/repoA` SHALL remain
- **AND** the unrelated spawn SHALL still auto-navigate when its own `session_added` arrives
