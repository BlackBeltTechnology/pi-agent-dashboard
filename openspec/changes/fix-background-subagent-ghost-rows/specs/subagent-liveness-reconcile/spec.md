# Spec Delta

## Purpose

Defines how the dashboard corrects a subagent it shows as queued or running when the owning session no longer runs it, using the session's answer to a stop and the session's registry snapshot. Covers the two session-to-dashboard frames that carry that information and the "ended, not tracked by its session" terminal presentation.

## ADDED Requirements

### Requirement: The session SHALL answer every per-subagent stop

When a session receives a per-subagent stop for agent A and at least one producer activation of that session handles stops, the session SHALL send exactly one `subagent_stop_result` frame for A, whatever the outcome, carrying `agentId`, `outcome` (`stopped` or `ignored`), `phase` and `answeredAt`. An answer produced while disconnected SHALL be sent once the bridge connects. When no producer activation answers, no frame SHALL be sent.

#### Scenario: Stop for a subagent the session runs
- **GIVEN** background subagent A is running in session S
- **WHEN** the dashboard stops A
- **THEN** S sends `subagent_stop_result { agentId: A, outcome: "stopped", phase: "running" }`
- **AND** A's own terminal frame with status `stopped` follows as today

#### Scenario: Older producer
- **WHEN** session S runs a producer that does not answer stops and the dashboard stops A
- **THEN** S sends no `subagent_stop_result` and the dashboard keeps its existing stop feedback

### Requirement: The stop answer phase SHALL say what the session knows about the subagent

`phase` SHALL be `queued` or `running` when a producer activation of the session tracked A in that phase when the stop arrived; `terminal` when an activation tracked A but A had already ended, with A's final `status` (`completed`, `failed` or `stopped`) when known; `unknown` when no activation tracks A. When several activations share the session's event bus, their answers SHALL be combined into one frame: `queued` or `running` wins over `terminal`, and `terminal` wins over `unknown`.

#### Scenario: Stop for a subagent the session no longer tracks
- **GIVEN** session S's pi process restarted, so no producer activation in S tracks A
- **WHEN** the dashboard stops A
- **THEN** S sends `subagent_stop_result { agentId: A, outcome: "ignored", phase: "unknown" }`

#### Scenario: Stop for a subagent that already ended
- **GIVEN** background subagent A completed in session S and S still holds its record
- **WHEN** the dashboard stops A
- **THEN** S sends `subagent_stop_result { agentId: A, outcome: "ignored", phase: "terminal", status: "completed" }`

#### Scenario: Two activations disagree
- **GIVEN** two producer activations share session S's event bus, one runs A and the other does not know A
- **WHEN** the dashboard stops A
- **THEN** S sends one `subagent_stop_result` for A with `phase: "running"` and `outcome: "stopped"`

### Requirement: The session SHALL publish its subagent registry when its bridge initializes

When the dashboard bridge of a session initializes (session start, extension reload, bridge takeover) and at least one producer activation answers, the session SHALL send one `subagent_registry_snapshot` frame listing every subagent its producer activations track, each entry with `agentId` and `status` (`queued`, `running`, `completed`, `failed` or `stopped`). An empty list SHALL still be sent: it means the session runs no subagents. When no activation answers, no snapshot SHALL be sent.

#### Scenario: Snapshot after a reload
- **GIVEN** session S's extensions reloaded and its new producer activation tracks no subagents
- **WHEN** S's bridge initializes
- **THEN** S sends `subagent_registry_snapshot` with no entries

#### Scenario: Transport reconnect sends no new snapshot
- **GIVEN** session S's bridge already initialized and sent its snapshot
- **WHEN** S's connection to the dashboard drops and reconnects
- **THEN** S sends no new snapshot

#### Scenario: Snapshot while subagents run
- **GIVEN** session S runs background subagent A and foreground subagent B, and background subagent C completed earlier in this process
- **WHEN** S's extensions reload while the activation keeps those records
- **THEN** the snapshot lists A `running`, B `running` and C `completed`

#### Scenario: No producer answers
- **WHEN** session S's bridge initializes and no producer activation is loaded
- **THEN** S sends no `subagent_registry_snapshot`

### Requirement: The registry snapshot SHALL carry the time it was taken

Each `subagent_registry_snapshot` SHALL carry `takenAt`, the time the registry was read. While the bridge is not connected, only the newest snapshot SHALL be kept, and it SHALL be sent once the bridge connects.

#### Scenario: Two reconnects while offline
- **GIVEN** session S's bridge initialized twice while the dashboard was unreachable
- **WHEN** the connection returns
- **THEN** the dashboard receives one snapshot, the newer one

### Requirement: A subagent its session does not run SHALL end as untracked

When a `subagent_stop_result` with `phase: "unknown"` (or `phase: "terminal"` without a `status`) arrives for agent A, or a `subagent_registry_snapshot` without A arrives, and A is `created` or `running` in that session, the dashboard SHALL make A terminal with the heal marker `untracked`. Its dock row SHALL leave the Processes lane, any pending stop notice for A SHALL clear, and A's full-screen view SHALL say its session no longer tracks it.

#### Scenario: Ghost row cleared by Stop
- **GIVEN** the dock shows background subagent A as running and its row reads `Stopping…`
- **WHEN** `subagent_stop_result { agentId: A, phase: "unknown" }` arrives
- **THEN** A's row leaves the Processes lane and no `Stopping…` or `Still running` notice remains

#### Scenario: Ghost rows cleared by the snapshot
- **GIVEN** the dock shows background subagents A and B as running in session S
- **WHEN** S sends `subagent_registry_snapshot` listing only B as `running`
- **THEN** A leaves the Processes lane as untracked and B stays

#### Scenario: Ended without a known status
- **GIVEN** A is `running` in the dashboard
- **WHEN** `subagent_stop_result { agentId: A, phase: "terminal" }` arrives without a `status`
- **THEN** A ends as untracked and leaves the Processes lane

#### Scenario: Foreground ghost finalizes its chat row
- **GIVEN** foreground subagent A's `Agent` chat row is still running and A is `running` in the map
- **WHEN** `subagent_stop_result { agentId: A, phase: "unknown" }` arrives
- **THEN** A ends as untracked and its chat row stops spinning, marked with the same heal marker

### Requirement: Reconcile SHALL NOT change a subagent it does not own

A reconcile frame SHALL NOT change a subagent that is already terminal, a subagent of another session, or a subagent for which a live frame was forwarded after the snapshot's `takenAt` or the answer's `answeredAt`. A live `subagent_started` frame for A arriving after A was ended as untracked SHALL make A running again and drop the `untracked` marker in the subagent state.

#### Scenario: Already-terminal subagent untouched
- **GIVEN** subagent A is `completed` with a result
- **WHEN** a snapshot without A arrives
- **THEN** A stays `completed` with its result

#### Scenario: Snapshot flushed after a newer subagent started
- **GIVEN** a snapshot with no entries was taken at time T while the bridge was disconnected
- **AND** subagent D started at T+1 s and its frames reached the dashboard first
- **WHEN** the buffered snapshot arrives
- **THEN** D stays running

#### Scenario: Live frame revives an untracked subagent
- **GIVEN** background subagent A was ended as untracked
- **WHEN** a `subagent_started` frame for A arrives afterwards
- **THEN** A is running again, the `untracked` marker is gone and A is back in the Processes lane

#### Scenario: Foreground subagent kept alive by its tool updates
- **GIVEN** foreground subagent A's only recent frames are its `Agent` tool's progress updates, the last forwarded at T+1 s
- **WHEN** a snapshot taken at T without A arrives
- **THEN** A stays running

#### Scenario: Late stop answer after a newer frame
- **GIVEN** a stop answer `phase: "unknown"` for A with `answeredAt` T was deferred
- **AND** a `subagent_started` frame for A forwarded at T+1 s reached the dashboard first
- **WHEN** the deferred answer arrives
- **THEN** A stays running

### Requirement: A known final status from the session SHALL be applied

When a `subagent_stop_result` with `phase: "terminal"` and a `status`, or a snapshot entry with a terminal `status`, arrives for agent A that is `created` or `running`, the dashboard SHALL set A to that status. A real terminal frame for A arriving later SHALL still win: its status, result and timeline replace the healed state.

#### Scenario: Missed completion recovered from the snapshot
- **GIVEN** A's `subagent_completed` frame was lost and the dock shows A as running
- **WHEN** a snapshot lists A as `completed`
- **THEN** A is `completed` and its row leaves the lane

#### Scenario: Real terminal frame wins
- **GIVEN** A was set to `completed` from a snapshot
- **WHEN** A's real `subagent_completed` frame with its result arrives
- **THEN** A shows that result

### Requirement: Reconcile frames SHALL replay in stream order

`subagent_stop_result` and `subagent_registry_snapshot` SHALL be stored in the session's event stream like other forwarded events, so a reload or full replay applies them at the same point in the stream and reaches the same subagent states.

#### Scenario: Reload after a reconcile
- **GIVEN** A was ended as untracked by a snapshot
- **WHEN** the user reloads the dashboard
- **THEN** A is still terminal as untracked and is not in the Processes lane

#### Scenario: Subagent created after the snapshot
- **GIVEN** a snapshot with no entries is in the stream
- **WHEN** subagent D is created afterwards
- **THEN** D runs and is listed normally
