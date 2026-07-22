# goal-detail-stats Specification

## Purpose
TBD - created by archiving change fix-goal-detail-turns-and-spend. Update Purpose after archive.
## Requirements
### Requirement: Goal turns gauges reflect persisted progress when the loop is not live
The goal turns gauges on both the detail page and the goals board SHALL render
`turnsUsed` from the live `goal_status` snapshot when one is available, and SHALL
otherwise fall back to the owning `GoalRecord.lastKnownTurnsUsed`. The denominator
SHALL be `GoalRecord.budget.maxTurns` when set, else the snapshot's `maxTurns`.
Only when neither a live snapshot nor a persisted turn count exists SHALL the
gauge show a placeholder (`—`). Session-scoped in-session controls that have no
access to the folder `GoalRecord` are out of scope for this requirement.

#### Scenario: Completed goal shows persisted turns
- **WHEN** a goal's driver session has ended (no live snapshot) and the record has `lastKnownTurnsUsed: 1` with `budget.maxTurns: 3`
- **THEN** the detail turns gauge SHALL read `1/3`
- **AND** SHALL NOT read `—/3`

#### Scenario: Board surface uses the same fallback
- **WHEN** the same completed goal is shown on the goals board
- **THEN** its turns ring SHALL reflect `lastKnownTurnsUsed` (not an empty/placeholder value)

#### Scenario: Live loop still prefers the live snapshot
- **WHEN** a driver is actively emitting `goal_status` snapshots
- **THEN** the gauge SHALL render the live `snap.turnsUsed`

#### Scenario: No data anywhere shows placeholder
- **WHEN** there is no live snapshot and the record has no `lastKnownTurnsUsed`
- **THEN** the gauge SHALL show `—` for the numerator

### Requirement: Goal spend is derived server-side and present on every goal delivery path
The server SHALL decorate each `GoalRecord` it emits with `totalSpendUsd`, the sum
of `DashboardSession.cost` over the goal's `sessionIds`, via a single shared
decoration applied at **every** server→client goal delivery path: the goals GET
endpoint, the POST/PATCH mutation responses, the link/unlink session-mutation
responses, and the `goals_update` broadcast. The decoration SHALL be pure — it
SHALL return new record objects and SHALL NOT mutate a stored/cached record in
place (mutation responses return cache-aliased records). A linked session with no
resolvable record or no `cost` SHALL contribute `0`, and a failing per-session
lookup SHALL NOT propagate (no 5xx). The sum SHALL be computed at read time
(server-owned join); clients SHALL NOT recompute it, and the value SHALL NOT be
written to the persisted goals file.

#### Scenario: Spend sums all linked sessions
- **WHEN** a goal links two sessions with `cost` `0.10` and `0.29`
- **THEN** the emitted record's `totalSpendUsd` SHALL be `0.39`

#### Scenario: Every delivery path carries the derived spend
- **WHEN** goals are delivered via the GET endpoint, a POST/PATCH response, or the `goals_update` broadcast
- **THEN** each delivered record SHALL carry `totalSpendUsd`

#### Scenario: Unresolvable or costless session contributes zero without failing
- **WHEN** a goal's `sessionIds` includes an id with no resolvable session, a session with no `cost`, or a lookup that throws
- **THEN** that entry SHALL contribute `0` to `totalSpendUsd`
- **AND** the endpoint/broadcast SHALL NOT error

#### Scenario: Derived spend is not persisted
- **WHEN** any goal has been decorated with `totalSpendUsd`
- **THEN** the persisted goals file SHALL NOT contain `totalSpendUsd`

#### Scenario: Decorating a mutation response does not leak to disk
- **WHEN** a goal is created/updated/linked/unlinked (a response path that returns a cache-aliased record) and the response is decorated
- **THEN** the persisted goals file SHALL NOT contain `totalSpendUsd` after the mutation

#### Scenario: Spend reflects only currently linked sessions
- **WHEN** a session contributing `0.20` is unlinked from a goal
- **THEN** the goal's subsequent `totalSpendUsd` SHALL no longer include that `0.20`

### Requirement: Goal spend gauges show actual spend against the cap
The spend gauges on both the detail page and the goals board SHALL render the
actual `GoalRecord.totalSpendUsd` formatted as USD. When `budget.maxSpendUsd` is
set, they SHALL render spend against the cap and fill proportionally; otherwise
they SHALL render spend with a "no cap" indicator and no fill. An absent or zero
spend SHALL render as `$0.00`. The cap fill is a display indicator only —
`maxSpendUsd` is not enforced at runtime.

#### Scenario: Spend with no cap
- **WHEN** `totalSpendUsd` is `0.29` and no `maxSpendUsd` is set
- **THEN** the spend gauge SHALL show `$0.29` with a "no cap" indicator and no fill

#### Scenario: Spend against a cap
- **WHEN** `totalSpendUsd` is `0.29` and `maxSpendUsd` is `5`
- **THEN** the spend gauge SHALL show `$0.29 / $5.00`
- **AND** the gauge SHALL fill proportionally (~6%)

#### Scenario: Zero spend
- **WHEN** `totalSpendUsd` is absent or `0`
- **THEN** the spend gauge SHALL show `$0.00`

