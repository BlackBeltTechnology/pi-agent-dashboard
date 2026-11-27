# Spec Delta

## MODIFIED Requirements

### Requirement: The session SHALL publish its subagent registry when its bridge initializes

When the dashboard bridge of a session initializes (session start, extension reload, bridge takeover) and at least one producer activation answers the `subagents:list` query (its result is still unset after the emit when none answers), the session SHALL send one `subagent_registry_snapshot` frame listing every background subagent the producer reports, each entry with `agentId` and `status` (`queued`, `running`, `idle`, `completed`, `failed` or `stopped`), and marked `background: true`. `idle` is the producer's status for a background run that ended and stays alive for continuation; the dashboard SHALL end a running row listed as `idle` with the revivable heal marker `idle`, which a later live `subagent_started` clears as it clears `untracked`. An empty list SHALL still be sent: it means the session runs no background subagents. When no activation answers, no snapshot SHALL be sent.

#### Scenario: Snapshot after a reload
- **GIVEN** session S's extensions reloaded and its new producer activation tracks no background subagents
- **WHEN** S's bridge initializes
- **THEN** S sends `subagent_registry_snapshot` with no entries

#### Scenario: Transport reconnect sends no new snapshot
- **GIVEN** session S's bridge already initialized and sent its snapshot
- **WHEN** S's connection to the dashboard drops and reconnects
- **THEN** S sends no new snapshot

#### Scenario: Snapshot while subagents run
- **GIVEN** session S runs background subagent A and foreground subagent B, and background subagent C completed earlier in this process
- **WHEN** S's extensions reload while the activation keeps those records
- **THEN** the snapshot lists A `running` and C `completed`, and does not list B

#### Scenario: No producer answers
- **WHEN** session S's bridge initializes and no producer activation is loaded
- **THEN** S sends no `subagent_registry_snapshot`

### Requirement: A subagent its session does not run SHALL end as untracked

When a `subagent_stop_result` with `phase: "unknown"` (or `phase: "terminal"` without a `status`) arrives for agent A, or a `subagent_registry_snapshot` without A arrives and A is a background subagent, and A is `created` or `running` in that session, the dashboard SHALL make A terminal with the heal marker `untracked`. A registry snapshot SHALL NOT end a foreground subagent, because the producer's registry lists background runs only. Its dock row SHALL leave the Processes lane, any pending stop notice for A SHALL clear, and A's full-screen view SHALL say its session no longer tracks it.

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

#### Scenario: Foreground row is not ended by a snapshot
- **GIVEN** the dashboard shows foreground subagent B running in session S
- **WHEN** S sends a `subagent_registry_snapshot` that does not list B
- **THEN** B SHALL stay as it is

#### Scenario: Idle background run ends its row
- **GIVEN** the dock shows background subagent A as running
- **WHEN** a snapshot lists A as `idle`
- **THEN** A SHALL end with heal marker `idle` and leave the Processes lane

#### Scenario: Steered idle run comes back
- **GIVEN** A was ended with heal marker `idle`
- **WHEN** a live `subagent_started` for A arrives after a steer
- **THEN** A SHALL be running again and the marker SHALL be gone

## REMOVED Requirements

### Requirement: The session SHALL answer every per-subagent stop
**Reason**: No released producer reports a stop outcome: `pi-dashboard-subagents` computes it and discards it. Owner decision: the dashboard does not synthesize an answer.
**Migration**: A stop settles through the subagent's own terminal frame (status `stopped`) and, for background runs, the next registry snapshot. The plugin's verdict combiner and its `subagents:stop_result` declaration are deleted.

### Requirement: The stop answer phase SHALL say what the session knows about the subagent
**Reason**: Its frame is never produced (see the removal above).
**Migration**: None. A `subagent_stop_result` that still arrives from an old stored stream is applied by the untracked rule unchanged.
