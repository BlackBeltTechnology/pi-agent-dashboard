## MODIFIED Requirements

### Requirement: Tool call state machine
A `tool_execution_start` event SHALL create a `ToolCallState` entry with `status: "running"`. A `tool_execution_end` event SHALL update the entry to `status: "complete"` (or `"error"` if `isError` is true) and store the result text. A tool call still `running` when a backfill segment has been fully reduced SHALL resolve to `status: "elided"`.

#### Scenario: Tool starts running
- **WHEN** a `tool_execution_start` event arrives
- **THEN** a new ToolCallState SHALL be created with `status: "running"`, `toolName`, and `args`

#### Scenario: Tool completes successfully
- **WHEN** a `tool_execution_end` event arrives with `isError: false`
- **THEN** the ToolCallState SHALL update to `status: "complete"` with the result

#### Scenario: Tool completes with error
- **WHEN** a `tool_execution_end` event arrives with `isError: true`
- **THEN** the ToolCallState SHALL update to `status: "error"` with the error result

#### Scenario: Every unfinished tool in a reduced backfill segment is elided
- **WHEN** a backfill segment has been fully reduced and one of its tool calls is still `running`
- **THEN** that tool call SHALL resolve to `status: "elided"`
- **AND** this SHALL hold regardless of the tool call's position within the segment

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

## ADDED Requirements

### Requirement: The chat row carries the elided tool status

The `elided` status SHALL be carried on the chat row's tool status, not only on the reducer's tool-call map, because a backfilled segment merges rows into session state without merging its tool-call map. Rows SHALL be stamped before the merge.

#### Scenario: Spliced row carries the status

- **WHEN** a backfilled segment containing an unfinished tool call is spliced into the transcript
- **THEN** the resulting chat row SHALL carry tool status `elided`

#### Scenario: Rendering never falls back to another status

- **WHEN** a tool row with status `elided` is passed to any tool renderer or grouping helper
- **THEN** it SHALL NOT be treated as `running`
- **AND** it SHALL NOT be treated as `complete`

### Requirement: An elided tool call renders as unloaded, not as failed or pending

A tool call with status `elided` SHALL be rendered with a neutral affordance stating its result is not loaded, and SHALL NOT be presented as an error, nor with a running indicator. The affordance SHALL remain visible however the row is grouped.

#### Scenario: No running indicator

- **WHEN** a tool row with status `elided` is rendered by any renderer, including the agent/subagent renderer
- **THEN** it SHALL NOT display a running spinner

#### Scenario: No error styling

- **WHEN** a tool row with status `elided` is rendered
- **THEN** it SHALL NOT use the error presentation used for a failed tool call

#### Scenario: Grouping does not absorb the affordance

- **WHEN** consecutive tool rows are grouped and one of them has status `elided`
- **THEN** the elided row SHALL NOT be absorbed into a collapsed group that hides its state
- **AND** it SHALL NOT be counted as completed in any group's done count

#### Scenario: Reconcile selectors reject an elided entry

- **WHEN** the stale running-tool selector or the supersede-heal selector is given session state containing a tool call with status `elided`
- **THEN** neither SHALL select it
- **AND** no supersede-heal sentinel SHALL be written into that row
