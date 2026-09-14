## ADDED Requirements

### Requirement: A shed session_updated SHALL be reconciled from current state

Dropping a `session_updated` frame is unbounded-stale: the frame carries no
sequence number, no backfill request answers it, and no later frame is
guaranteed to supersede it — a session that changes status once and then runs
for minutes (a long tool call) leaves the browser showing the pre-change value
until a reconnect. The server SHALL therefore treat a shed `session_updated` as
a debt owed to that socket.

When a `session_updated` frame is dropped for a browser socket under
back-pressure, the server SHALL record the affected session id for that socket
and, within 1 second of the socket's buffered amount falling back under the
threshold, SHALL send that socket a `session_updated` rebuilt from the session's
CURRENT server-held state. The recorded set SHALL hold identifiers only — never a queued payload —
so it cannot contribute to the pending-state byte ceiling or to
`stalledSocketsTerminated`.

The reconcile SHALL be self-healing: a reconcile frame that is itself shed SHALL
re-record the session id, so delivery is eventually-consistent rather than
attempted once. The reconcile SHALL carry the CURRENT value, not the shed one;
an intermediate transition that was shed within a single flood window is NOT
recovered, and only the settled value is guaranteed.

The recorded set and any timer serving it SHALL be released when the socket
closes, errors, or is terminated as stalled.

This obligation covers `session_updated` only. `session_added`,
`session_removed`, and `sessions_reordered` remain transcript-class and remain
unrecovered by this requirement.

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

### Requirement: Socket buffer occupancy SHALL be observable

Back-pressure incidents are currently diagnosable only by inference from
cumulative, instance-wide drop counters, which cannot attribute saturation to a
socket or bound its duration. The health endpoint SHALL expose per-browser-socket
buffered-amount occupancy — the observed maximum, the p95, and the cumulative
milliseconds spent above the threshold since boot — so a saturation claim can be
measured rather than inferred.

#### Scenario: Occupancy is reported

- **WHEN** `/api/health` is fetched while at least one browser socket is connected
- **THEN** the response SHALL report buffered-amount occupancy for browser sockets
- **AND** the reported values SHALL include `max`, `p95`, and cumulative
  milliseconds above the threshold

#### Scenario: Occupancy is reported without a saturation event

- **WHEN** `/api/health` is fetched on an instance that has never crossed the threshold
- **THEN** the occupancy fields SHALL be present and numeric

## MODIFIED Requirements

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
