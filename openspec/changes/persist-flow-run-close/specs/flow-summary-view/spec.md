## ADDED Requirements

### Requirement: Dismissal survives replay
Dismissing a finished flow run that carries a `runId` SHALL be persisted by the flows plugin bridge as a `flow-run-close` session entry, and the reduced flow state SHALL exclude every run whose `runId` was dismissed, regardless of the order in which the dismiss and the run's events arrive. A dismiss without a `runId` SHALL keep the live-only clear-all behaviour.

#### Scenario: Dismissed run stays dismissed after reload
- **GIVEN** a finished run `batch:apply` with `runId` `r1` that the user dismissed while the session was connected
- **WHEN** the session is replayed from its persisted entries
- **THEN** the flow slot SHALL NOT show `batch:apply`

#### Scenario: Close record sorted before the run's events
- **WHEN** the reducer receives `flow_summary_dismissed { runId: "r1" }` before `flow_started { runId: "r1" }` and `flow_complete` for that run
- **THEN** the resulting flow state SHALL NOT contain run `r1`

#### Scenario: Only the dismissed run is removed
- **GIVEN** finished runs `r1` (`alpha`) and `r2` (`beta`)
- **WHEN** `flow_summary_dismissed { runId: "r1" }` is reduced
- **THEN** `beta` SHALL remain in the flow state and `alpha` SHALL NOT

#### Scenario: Legacy dismiss without runId
- **WHEN** `flow_summary_dismissed {}` is reduced
- **THEN** the flow state SHALL be cleared as before and the bridge SHALL persist nothing
