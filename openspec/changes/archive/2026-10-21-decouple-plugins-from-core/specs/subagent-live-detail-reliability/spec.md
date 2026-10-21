## MODIFIED Requirements

### Requirement: Running subagent timeline hydrated from the durable partialResult channel

The subagents plugin's `Agent` finalizer (`onToolExecution`, `dashboard-plugin-loader`) SHALL hydrate a running subagent's `session.subagents` entry from the durable `tool_execution_update` `partialResult`, not only from ephemeral `subagents:*` frames and the completion backfill, when an `Agent` row's `details` carry `agentId`. It SHALL reuse the backfill's detail mapping and dual index, SHALL NOT regress a really-terminal subagent, and SHALL add no bounded structure.

#### Scenario: Running partialResult hydrates the inspector map live

- **GIVEN** an Agent tool row and a `tool_execution_update` whose `partialResult.details` carry `agentId`, `status: "running"`, and a non-empty `entries[]`
- **WHEN** the reducer processes the update
- **THEN** `session.subagents.get(agentId)` SHALL be defined with `status: "running"` and the given `entries[]`
- **AND** when `details.agentSessionId` is present, `session.subagents.get(agentSessionId)` SHALL return the SAME `SubagentState` reference

#### Scenario: Late running partial does not regress a completed subagent

- **GIVEN** an Agent subagent whose `SubagentState` is already `completed` (via `tool_execution_end`)
- **WHEN** a late/reordered running `tool_execution_update` for the same `agentId` is processed
- **THEN** the `SubagentState` status SHALL remain `completed` (no regression to `running`)

#### Scenario: Non-Agent partialResult does not touch the subagents map

- **GIVEN** a non-Agent tool row and a structured `tool_execution_update` whose `details` carry no `agentId`
- **WHEN** the reducer processes the update
- **THEN** `session.subagents` SHALL be unchanged

#### Scenario: a session_ended-healed subagent is revived by a live tick
- **GIVEN** subagent `ag-1` is `failed` with the `session_ended` heal marker (from a synthesized end)
- **WHEN** a running `tool_execution_update` for its Agent row with `details.agentId:"ag-1"` reduces
- **THEN** `ag-1` status SHALL be `running` and the heal marker SHALL be cleared

#### Scenario: a really-terminal subagent is not revived
- **GIVEN** subagent `ag-1` is `completed` or `failed` through a real `subagent_completed`/`subagent_failed` or real Agent end
- **WHEN** a running `tool_execution_update` for it reduces
- **THEN** `ag-1` status SHALL remain terminal

#### Scenario: Inspector renders under frame loss

- **GIVEN** the ephemeral `subagents:*` frames of a running subagent were lost to bridge-not-ready buffering or WS back-pressure, and its durable `partialResult` updates arrived
- **WHEN** the user opens the subagent inspector during the run
- **THEN** it SHALL render the live timeline, or the running "No detail available yet." state once a map entry exists, and SHALL NOT show "Subagent not found in this session."

#### Scenario: Hydration is plugin code

- **GIVEN** the subagents plugin is disabled
- **WHEN** an `Agent` `tool_execution_update` carrying `details.agentId` reduces
- **THEN** `session.subagents` SHALL be unchanged, and core reducer code SHALL contain no writer of it
