## MODIFIED Requirements

### Requirement: Tool call state machine
A `tool_execution_start` event without `parentToolCallId` SHALL create a `ToolCallState` entry with `status: "running"`. Any `tool_execution_start`, `tool_execution_update` or `tool_execution_end` carrying `parentToolCallId` is a nested call: it SHALL NOT create or update a top-level `ToolCallState` and follows "Nested tool calls render inside their parent tool call" instead. A `tool_execution_end` event without `parentToolCallId` SHALL update the entry to `status: "complete"` (or `"error"` if `isError` is true) and store the result text. A tool call still `running` when a backfill segment has been fully reduced SHALL resolve to `status: "elided"`, except a call the backfill response reports as open, which SHALL remain `running`. A `tool_execution_update` without `parentToolCallId` for an `elided` call SHALL return it to `status: "running"`, unless it is a subagent call whose subagent the client already records as terminal.

#### Scenario: Tool starts running
- **WHEN** a `tool_execution_start` event without `parentToolCallId` arrives
- **THEN** a new ToolCallState SHALL be created with `status: "running"`, `toolName`, and `args`

#### Scenario: Tool completes successfully
- **WHEN** a `tool_execution_end` event arrives with `isError: false`
- **THEN** the ToolCallState SHALL update to `status: "complete"` with the result

#### Scenario: Tool completes with error
- **WHEN** a `tool_execution_end` event arrives with `isError: true`
- **THEN** the ToolCallState SHALL update to `status: "error"` with the error result

#### Scenario: Every unfinished tool in a reduced backfill segment is elided
- **WHEN** a backfill segment has been fully reduced and one of its tool calls is still `running`
- **AND** the backfill response does not report that call as open
- **THEN** that tool call SHALL resolve to `status: "elided"`
- **AND** this SHALL hold regardless of the tool call's position within the segment

#### Scenario: A reported-open tool in a reduced backfill segment stays running
- **WHEN** a backfill segment has been fully reduced and one of its tool calls is still `running`
- **AND** the backfill response reports that call as open
- **THEN** that tool call SHALL remain `status: "running"`
- **AND** a later `tool_execution_end` for it SHALL resolve it to `complete` or `error`
- **AND** a later synthesized session-end heal for it SHALL resolve it to a terminal status

#### Scenario: A kept or revived call is superseded only by a later inference
- **WHEN** a tool call was kept running by a backfill splice or revived by an update
- **AND** an assistant inference starts after that splice or revive and the call's result is still unavailable
- **THEN** the call SHALL be eligible for the superseded heal
- **AND** inferences that started before the splice or revive SHALL NOT count as evidence

#### Scenario: A live update revives an elided tool call
- **WHEN** a tool call has `status: "elided"`
- **AND** a `tool_execution_update` without `parentToolCallId` arrives for it, with or without a partial result
- **THEN** that tool call SHALL have `status: "running"`
- **AND** its row SHALL no longer carry a terminal detail status
- **AND** a later synthesized session-end heal for it SHALL resolve it to a terminal status

#### Scenario: A late update for a finished subagent does not revive
- **WHEN** a subagent tool call has `status: "elided"`
- **AND** the client already records its subagent as terminal
- **AND** a `tool_execution_update` without `parentToolCallId` arrives for it
- **THEN** that tool call SHALL keep `status: "elided"`

#### Scenario: A revived subagent call still hydrates its subagent
- **WHEN** an update revives an elided subagent tool call whose subagent is not terminal
- **THEN** the session's subagent state SHALL be hydrated from that update as for any running subagent call

#### Scenario: A nested update never revives an elided root
- **WHEN** a tool call has `status: "elided"`
- **AND** a `tool_execution_update` carrying `parentToolCallId` naming that call arrives
- **THEN** that tool call SHALL keep `status: "elided"`

#### Scenario: An assistant row left streaming by a backfill segment is finalized
- **WHEN** a backfill segment has been fully reduced and one of its assistant rows is still marked as streaming
- **THEN** that row SHALL no longer be marked as streaming

#### Scenario: A live in-flight tool is never elided
- **WHEN** a `tool_execution_start` arrives on the live event path and no `tool_execution_end` has arrived yet
- **THEN** the entry SHALL remain `status: "running"`

#### Scenario: An unfinished tool at the end of an initial windowed replay is not elided
- **WHEN** an initial windowed replay is fully applied and one of its tool calls is still `running`
- **THEN** that tool call SHALL remain `status: "running"`
- **AND** it SHALL remain eligible for the stale running-tool reconcile
