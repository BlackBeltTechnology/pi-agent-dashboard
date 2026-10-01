## MODIFIED Requirements

### Requirement: The client reducer tolerates orphaned events at a window edge

Replay SHALL NOT fail when a delivered segment begins or ends on an event whose structural partner was elided. A tool call left unfinished by a backfill segment SHALL resolve to a truthful terminal state rather than remaining indistinguishable from a tool that is still running.

A `tool_execution_start` carrying `parentToolCallId` is a nested call, not a tool row: the elision rules of this requirement apply to top-level starts only, and a nested start without an end in a segment SHALL NOT create or elide any row.

#### Scenario: Orphaned message_end does not crash the reducer

- **WHEN** a delivered segment begins with a `message_end` whose `message_start` was elided
- **THEN** the reducer SHALL produce a state without throwing

#### Scenario: Orphaned tool_execution_end does not crash the reducer

- **WHEN** a delivered segment begins with a `tool_execution_end` whose `tool_execution_start` was elided
- **THEN** the reducer SHALL produce a state without throwing

#### Scenario: An unjoinable tool start in a backfill segment resolves to elided

- **WHEN** a backfill segment is fully reduced and contains a `tool_execution_start` with no `tool_execution_end` in that segment
- **THEN** that tool row SHALL carry status `elided`
- **AND** it SHALL NOT be rendered as running
- **AND** it SHALL NOT be rendered as an error

#### Scenario: A dangling tool at the live end of the stream stays running

- **WHEN** a windowed replay's tail ends with a `tool_execution_start` because the tool is still executing
- **THEN** that tool row SHALL carry status `running`
- **AND** it SHALL remain eligible for the stale running-tool reconcile

#### Scenario: Nested start at a window edge is not elided as a row
- **WHEN** a backfill segment contains a `tool_execution_start` with `parentToolCallId` and no matching end
- **THEN** no top-level tool row SHALL be created or marked `elided` for it
