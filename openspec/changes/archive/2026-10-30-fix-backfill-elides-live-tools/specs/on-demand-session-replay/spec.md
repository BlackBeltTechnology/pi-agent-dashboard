## MODIFIED Requirements

### Requirement: The client reducer tolerates orphaned events at a window edge

Replay SHALL NOT fail when a delivered segment begins or ends on an event whose structural partner was elided. A tool call left unfinished by a backfill segment SHALL resolve to a truthful terminal state rather than remaining indistinguishable from a tool that is still running — UNLESS the backfill response reports that call as still open, in which case it SHALL remain running. A tool call resolved to `elided` that subsequently receives a top-level progress update SHALL be treated as running again, unless it is a subagent call whose subagent the client already records as terminal.

A `tool_execution_start` carrying `parentToolCallId` is a nested call, not a tool row: the elision rules of this requirement apply to top-level starts only, and a nested start without an end in a segment SHALL NOT create or elide any row. An orphaned `tool_execution_end` carrying `nestedCalls` whose root start was elided SHALL NOT create a row or nested entries.

#### Scenario: Orphaned message_end does not crash the reducer

- **WHEN** a delivered segment begins with a `message_end` whose `message_start` was elided
- **THEN** the reducer SHALL produce a state without throwing

#### Scenario: Orphaned tool_execution_end does not crash the reducer

- **WHEN** a delivered segment begins with a `tool_execution_end` whose `tool_execution_start` was elided
- **THEN** the reducer SHALL produce a state without throwing

#### Scenario: An unjoinable tool start in a backfill segment resolves to elided

- **WHEN** a backfill segment is fully reduced and contains a `tool_execution_start` with no `tool_execution_end` in that segment
- **AND** the backfill response does not report that call as open
- **THEN** that tool row SHALL carry status `elided`
- **AND** it SHALL NOT be rendered as running
- **AND** it SHALL NOT be rendered as an error

#### Scenario: A backfilled start the server reports open stays running

- **WHEN** a backfill segment contains a `tool_execution_start` with no `tool_execution_end` in that segment
- **AND** the backfill response reports that call as open
- **THEN** that tool row SHALL carry status `running`
- **AND** a later `tool_execution_end` for that call SHALL resolve it to `complete` or `error`
- **AND** a later synthesized session-end heal for that call SHALL resolve it to a terminal status

#### Scenario: A progress update revives an elided tool row

- **WHEN** a tool row carries status `elided`
- **AND** a top-level `tool_execution_update` for that call arrives
- **THEN** that tool row SHALL carry status `running`
- **AND** it SHALL NOT be rendered as "result not loaded"
- **AND** a later synthesized session-end heal for that call SHALL resolve it to a terminal status

#### Scenario: A late update for a finished subagent keeps the row as it was

- **WHEN** a subagent tool row carries status `elided` and the client records its subagent as terminal
- **AND** a top-level `tool_execution_update` for that call arrives
- **THEN** that tool row SHALL keep status `elided`

#### Scenario: A dangling tool at the live end of the stream stays running

- **WHEN** a windowed replay's tail ends with a `tool_execution_start` because the tool is still executing
- **THEN** that tool row SHALL carry status `running`
- **AND** it SHALL remain eligible for the stale running-tool reconcile

#### Scenario: Nested start at a window edge is not elided as a row
- **WHEN** a backfill segment contains a `tool_execution_start` with `parentToolCallId` and no matching end
- **THEN** no top-level tool row SHALL be created or marked `elided` for it

#### Scenario: Orphaned end carrying nestedCalls creates nothing
- **WHEN** a delivered segment begins with a `tool_execution_end` for `call_1` carrying `nestedCalls` and the `tool_execution_start` for `call_1` was elided
- **THEN** the reducer SHALL produce a state without throwing
- **AND** no tool row and no nested entries SHALL be created for `call_1`
