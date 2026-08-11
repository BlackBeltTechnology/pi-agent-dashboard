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

- **GIVEN** a subagent whose accumulated timeline grows from 10 to 100 entries
- **WHEN** it emits successive progress ticks across that growth
- **THEN** serialized tick payload size SHALL grow by no more than **2x**
  across that 10x growth in entry count
- **AND** the bound SHALL be asserted against the serialized bytes actually
  broadcast, not against the in-memory object

#### Scenario: A reduced payload folds to the same state as a full payload

- **GIVEN** a session recorded under the full-payload producer
- **AND** the same session recorded under the reduced-payload producer
- **WHEN** each is folded by the client reducer, live and via replay
- **THEN** both SHALL yield the same rendered subagent state, preserving the
  accumulative merge, the `entries` empty-array overwrite guard, and first-wins
  `type`/`description`

#### Scenario: A late joiner folds correctly from EMPTY state

- **GIVEN** a consumer holding NO prior state for a subagent already mid-run
  (a reconnect, a replay, or a browser opened after the run started)
- **WHEN** it folds the reduced-payload stream from empty
- **THEN** it SHALL reach the same rendered state as a consumer that folded the
  full-payload stream from the beginning
- **AND** a delta that references state the consumer never received SHALL be
  recoverable, not silently dropped

#### Scenario: The dashboard stays correct against an old producer

- **GIVEN** a `pi-dashboard-subagents` version that still sends full payloads
- **WHEN** it runs against a dashboard expecting reduced payloads
- **THEN** the subagent timeline SHALL still render correctly
