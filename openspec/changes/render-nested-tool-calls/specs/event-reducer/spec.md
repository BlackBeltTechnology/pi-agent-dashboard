## ADDED Requirements

### Requirement: Nested tool calls render inside their parent tool call

A tool execution event carrying `parentToolCallId` (pi ≥ 0.99: codemode scripts and `ctx.executeTool()`) SHALL be attached as a nested call to its **root** tool call — the model-issued call whose id is the first `/`-separated segment of the nested id (pi assigns `<caller id>/<n>` recursively, so `call_1/1/2` belongs to `call_1`). The nested entry SHALL keep its direct `parentToolCallId` so a grandchild can be shown under its caller. It SHALL NOT create a top-level chat row. A nested call SHALL NOT be counted by the stale running-tool reconcile or by the elision rule as an independent tool call. On replay, where pi records nested calls only as `nestedCalls` on the parent's tool-result message, the reducer SHALL rebuild nested entries from that record: status `ok` → complete, `error` → error, `unfinished` → unfinished (rendered as neither running nor failed); `arguments` when present, otherwise an "arguments omitted (N bytes)" note from `argumentsBytes`. When the record's `complete` flag is false, the parent SHALL show that further nested calls were not recorded. The live view may show more nested calls than replay; that difference SHALL be signalled by the not-recorded notice, never hidden.

#### Scenario: Live nested call attaches to parent
- **WHEN** `tool_execution_start` arrives with `toolCallId: "call_1/1"` and `parentToolCallId: "call_1"` while `call_1` is running
- **THEN** no new top-level ToolCallState SHALL be created
- **AND** `call_1` SHALL list a nested call `call_1/1` with status `running`

#### Scenario: Nested call completes
- **WHEN** `tool_execution_end` arrives for `call_1/1` with `isError: true`
- **THEN** the nested entry SHALL show status `error`
- **AND** the parent `call_1` status SHALL be unchanged

#### Scenario: Replay rebuilds nested calls
- **WHEN** a session is replayed whose tool-result message for `call_1` carries `nestedCalls` with two records (`ok`, `error`)
- **THEN** `call_1` SHALL list those two nested calls with their recorded name, status and `durationMs`

#### Scenario: Truncated record is signalled
- **WHEN** a replayed `nestedCalls` has `complete: false` and one record with `status: "unfinished"` and `argumentsBytes` instead of `arguments`
- **THEN** `call_1` SHALL show the not-recorded notice, the unfinished call as unfinished, and "arguments omitted" with the byte count

#### Scenario: Grandchild call attaches to the root
- **WHEN** `tool_execution_start` arrives with `toolCallId: "call_1/1/1"` and `parentToolCallId: "call_1/1"` while `call_1` is running
- **THEN** `call_1` SHALL list `call_1/1/1` as a nested call under `call_1/1`

#### Scenario: Parent end closes running nested calls
- **WHEN** `call_1` ends while its nested entry `call_1/1` is still running
- **THEN** `call_1/1` SHALL show status unfinished

#### Scenario: Late nested end after the root ended
- **WHEN** `call_1` ended (marking `call_1/1` unfinished) and a real `tool_execution_end` for `call_1/1` then arrives with `isError: false`
- **THEN** `call_1/1` SHALL show status complete

#### Scenario: Nested update refreshes the nested entry
- **WHEN** `tool_execution_update` arrives for running nested call `call_1/1`
- **THEN** the nested entry SHALL show the latest partial result and no top-level row SHALL be created

#### Scenario: Replay record merges with live entries
- **WHEN** live entries `call_1/1` and `call_1/2` exist and the tool-result for `call_1` arrives carrying `nestedCalls` with records for `call_1/1` and `call_1/2`
- **THEN** each nested entry SHALL take the recorded status and duration and keep its live result
- **AND** a live entry absent from a record with `complete: false` SHALL be kept

#### Scenario: Nested bash counts as in-flight work
- **WHEN** a nested `bash` call is running
- **THEN** the session's in-flight bash indicator SHALL include it

#### Scenario: Non-conforming id falls back to the parent chain
- **WHEN** a nested event's id does not start with a known root but its `parentToolCallId` names a known nested entry
- **THEN** it SHALL attach to that entry's root

#### Scenario: Orphan nested event
- **WHEN** a nested event arrives whose root tool call is unknown
- **THEN** the reducer SHALL drop it without creating a top-level row and without throwing

#### Scenario: Nested result fetch with a slash in the id
- **WHEN** a nested call `call_1/1` has a truncated live result and the user expands it
- **THEN** the full result SHALL be fetched from the tool-result endpoint successfully (the id is URL-encoded as one path segment)
- **AND** a full-fidelity diff upgrade for a nested `edit`/`write` SHALL NOT be attempted, because pi writes no transcript entry for nested calls

#### Scenario: Nested calls never mark the session stuck
- **WHEN** a parent tool call has completed and one of its nested entries never received an end event
- **THEN** the stale running-tool reconcile SHALL NOT report a stuck tool for that nested entry

## MODIFIED Requirements

### Requirement: Tool call state machine
A `tool_execution_start` event without `parentToolCallId` SHALL create a `ToolCallState` entry with `status: "running"`; one with `parentToolCallId` is a nested call and follows "Nested tool calls render inside their parent tool call" instead. A `tool_execution_end` event SHALL update the entry to `status: "complete"` (or `"error"` if `isError` is true) and store the result text. A tool call still `running` when a backfill segment has been fully reduced SHALL resolve to `status: "elided"`.

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
