## ADDED Requirements

### Requirement: Durable goal status reflects the live loop
The goal status consumer SHALL project each `goal_status` snapshot onto the owning
`GoalRecord`'s durable `status`, mapping `active→pursuing`, `paused→paused`,
`done→achieved`, `cleared→cleared`. The owning goal SHALL be resolved from the
emitting session's `goalId`. Status writes SHALL be idempotent — the store SHALL
be updated (and subscribers notified) only when the projected status changes.

#### Scenario: Achieved goal persists across restart
- **WHEN** a driver emits a `goal-achieved` snapshot for a goal
- **THEN** the `GoalRecord.status` SHALL be persisted as `achieved`
- **AND** after a server restart the record SHALL still read `achieved`

#### Scenario: Redundant snapshot does not rewrite
- **WHEN** consecutive snapshots carry the same mapped status
- **THEN** the store SHALL NOT be written a second time for the status field

#### Scenario: Snapshot for an unlinked session is ignored
- **WHEN** a `goal_status` snapshot arrives from a session with no `goalId`
- **THEN** no `GoalRecord` SHALL be modified

### Requirement: Turn progress is persisted and cumulative across drivers
The consumer SHALL maintain on the `GoalRecord`: `lastKnownTurnsUsed` (the latest
`turnsUsed` observed), `totalTurnsUsed` (cumulative across all drivers of the
goal), and `lastProgressAt` (timestamp of the last strict `turnsUsed` increase).
`totalTurnsUsed` SHALL increment by the non-negative delta of a single driver's
`turnsUsed` and SHALL NOT double-count across drivers.

#### Scenario: Cumulative across two drivers
- **WHEN** driver A reports turnsUsed 0→3, then a new driver B reports 0→2 for the same goal
- **THEN** `totalTurnsUsed` SHALL be 5
- **AND** `lastKnownTurnsUsed` SHALL be 2

#### Scenario: Progress timestamp only on increase
- **WHEN** a snapshot repeats the same `turnsUsed` as the previous one
- **THEN** `lastProgressAt` SHALL NOT change
- **AND** a later snapshot with a higher `turnsUsed` SHALL update `lastProgressAt`

#### Scenario: First observed turns are not lost
- **WHEN** the first snapshot observed for a driver already reports `turnsUsed` > 0 and no prior baseline exists
- **THEN** those turns SHALL be counted toward `totalTurnsUsed` (not silently treated as an uncounted baseline)

### Requirement: Persistence is additive and backward compatible
The new fields (`lastKnownTurnsUsed`, `totalTurnsUsed`, `lastProgressAt`) SHALL be
optional. A `GoalRecord` created before this change SHALL load without error, and
its fields SHALL be backfilled on the first subsequent snapshot.

#### Scenario: Legacy record loads and backfills
- **WHEN** a pre-change `GoalRecord` (no turn fields) is loaded
- **THEN** it SHALL load without error
- **AND** the first `goal_status` snapshot afterward SHALL populate the turn fields
