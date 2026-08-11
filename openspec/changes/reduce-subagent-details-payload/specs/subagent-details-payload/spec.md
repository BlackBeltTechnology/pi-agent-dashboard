## ADDED Requirements

### Requirement: A subagent tick SHALL NOT re-send the full cumulative timeline

A `tool_execution_update` carrying `subagent_*` progress SHALL NOT restate the
entire accumulated timeline on every tick. The payload SHALL carry only what the
consumer cannot already derive from state it holds.

Rationale: retention was bounded by
`collapse-superseded-tool-execution-updates` (36 → 2 retained ticks per
`toolCallId`), but average bytes/event ROSE (1240 → 1350 B) because the cost is
concentrated in the surviving payloads. Count and size are independent levers.

#### Scenario: A long-running subagent's tick size stays flat

- **GIVEN** a subagent that has accumulated many timeline entries
- **WHEN** it emits successive progress ticks
- **THEN** tick payload size SHALL NOT grow in proportion to the accumulated
  entry count

#### Scenario: A reduced payload folds to the same state as a full payload

- **GIVEN** a session recorded under the full-payload producer
- **AND** the same session recorded under the reduced-payload producer
- **WHEN** each is folded by the client reducer, live and via replay
- **THEN** both SHALL yield the same rendered subagent state, preserving the
  accumulative merge, the `entries` empty-array overwrite guard, and first-wins
  `type`/`description`

#### Scenario: The dashboard stays correct against an old producer

- **GIVEN** a `pi-dashboard-subagents` version that still sends full payloads
- **WHEN** it runs against a dashboard expecting reduced payloads
- **THEN** the subagent timeline SHALL still render correctly
