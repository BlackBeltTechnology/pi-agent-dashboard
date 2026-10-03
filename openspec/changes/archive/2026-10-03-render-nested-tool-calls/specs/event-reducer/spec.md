## ADDED Requirements

### Requirement: Nested tool calls render inside their parent tool call

A tool execution event carrying `parentToolCallId` (pi ≥ 0.99: codemode scripts and `ctx.executeTool()`) SHALL be attached as a nested call to its **root** tool call — the model-issued call whose id is the first `/`-separated segment of the nested id (pi assigns `<caller id>/<n>` recursively, so `call_1/1/2` belongs to `call_1`). The nested entry SHALL keep its direct `parentToolCallId` so a grandchild can be shown under its caller. It SHALL NOT create a top-level chat row and SHALL NOT change `SessionState.currentTool`. A nested entry's status is one of `running`, `complete`, `error` or `unfinished`. A nested call SHALL NOT be counted by the stale running-tool reconcile or by the elision rule as an independent tool call. pi records nested calls as `nestedCalls` on the root's tool-result message (live: the toolResult `message_start`/`message_end`; transcript replay: the synthesized `tool_execution_end`, onto which transcript replay SHALL copy the message's `nestedCalls`). Only an event carrying `parentToolCallId` is nested. A record-sourced entry's parent is its id minus the last `/` segment. Whenever such a record arrives, the reducer SHALL merge it into the root's nested list: a record id with an existing entry updates its status and duration and keeps its live result; a record id without an entry creates one; an entry absent from the record is kept. Records map as follows: status `ok` → complete, `error` → error, `unfinished` → unfinished (rendered as neither running nor failed); `arguments` when present, otherwise an "arguments omitted (N bytes)" note from `argumentsBytes`. When the record's `complete` flag is false, the parent SHALL show a generic incomplete-record notice; because pi sets `complete:false` for dropped calls, omitted arguments, or unfinished calls alike, the notice SHALL NOT claim which of these occurred. The live view may show more nested calls than a recorded replay; when the record is incomplete this SHALL be signalled by the incomplete-record notice. When the root never finished, pi writes no record and transcript replay shows no nested entries. No nested entry SHALL remain `running` while its root tool call is terminal (complete, error or elided): a root's terminal transition and every record merge SHALL mark running nested entries unfinished, and a nested start whose root is already terminal SHALL be created unfinished. The session's in-flight bash indicator SHALL include running nested `bash` entries. A nested event SHALL NOT trigger the streaming-text flush. A nested call's result SHALL be truncated and offer the full-output affordance under the same rules as a top-level tool result.

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
- **THEN** `call_1` SHALL show the incomplete-record notice, the unfinished call as unfinished, and "arguments omitted" with the byte count

#### Scenario: Grandchild call attaches to the root
- **WHEN** `tool_execution_start` arrives with `toolCallId: "call_1/1/1"` and `parentToolCallId: "call_1/1"` while `call_1` is running
- **THEN** `call_1` SHALL list `call_1/1/1` as a nested call under `call_1/1`

#### Scenario: Parent end closes running nested calls
- **WHEN** `call_1` ends while its nested entry `call_1/1` is still running
- **THEN** `call_1/1` SHALL show status unfinished

#### Scenario: Late nested end after the root ended
- **WHEN** `call_1` ended (marking `call_1/1` unfinished) and a real `tool_execution_end` for `call_1/1` then arrives with `isError: false`
- **THEN** `call_1/1` SHALL show status complete

#### Scenario: Late nested start after the root ended
- **WHEN** `call_1` has ended and a `tool_execution_start` for `call_1/2` with `parentToolCallId: "call_1"` then arrives
- **THEN** `call_1/2` SHALL be listed with status unfinished, not running

#### Scenario: Nested start does not flush streaming text
- **WHEN** `streamingText` is non-empty and a `tool_execution_start` carrying `parentToolCallId` arrives
- **THEN** no assistant row SHALL be pushed, `streamingText` SHALL be unchanged and `streamingTextFlushed` SHALL be unchanged

#### Scenario: Long nested result is truncated with the full-output affordance
- **WHEN** a nested `tool_execution_end` for `call_1/1` carries a result longer than the tool-result truncation limit
- **THEN** the nested entry SHALL keep the last lines with the omission marker
- **AND** SHALL offer the full-output affordance

#### Scenario: Nested update refreshes the nested entry
- **WHEN** `tool_execution_update` arrives for running nested call `call_1/1`
- **THEN** the nested entry SHALL show the latest partial result and no top-level row SHALL be created

#### Scenario: Replay record merges with live entries
- **WHEN** live entries `call_1/1` and `call_1/2` exist and the tool-result for `call_1` arrives carrying `nestedCalls` with records for `call_1/1` and `call_1/2`
- **THEN** each nested entry SHALL take the recorded status and duration and keep its live result
- **AND** a live entry absent from the record SHALL be kept

#### Scenario: Record entry without a live entry is created
- **WHEN** a record for `call_1` lists `call_1/1` and `call_1/2` but only `call_1/1` was seen live
- **THEN** `call_1` SHALL list both, `call_1/2` with its recorded status

#### Scenario: Live record merge leaves nothing running
- **WHEN** `call_1` has ended, a live entry `call_1/3` is still running and absent from the record, and the record arrives on the toolResult `message_end`
- **THEN** `call_1/3` SHALL be kept with status unfinished

#### Scenario: Nested start under an elided root
- **WHEN** a nested start arrives for a root whose status is `elided`
- **THEN** the nested entry SHALL be created unfinished

#### Scenario: Nested events leave currentTool alone
- **WHEN** `SessionState.currentTool` is `codemode` and a nested `tool_execution_start` for `bash` then its `tool_execution_end` arrive
- **THEN** `SessionState.currentTool` SHALL remain `codemode` throughout

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
A `tool_execution_start` event without `parentToolCallId` SHALL create a `ToolCallState` entry with `status: "running"`. Any `tool_execution_start`, `tool_execution_update` or `tool_execution_end` carrying `parentToolCallId` is a nested call: it SHALL NOT create or update a top-level `ToolCallState` and follows "Nested tool calls render inside their parent tool call" instead. A `tool_execution_end` event without `parentToolCallId` SHALL update the entry to `status: "complete"` (or `"error"` if `isError` is true) and store the result text. A tool call still `running` when a backfill segment has been fully reduced SHALL resolve to `status: "elided"`.

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

### Requirement: Streaming text flushed at tool_execution_start to preserve content-array order

The reducer SHALL flush a non-empty `streamingText` into a permanent `role:"assistant"` `ChatMessage` row at `tool_execution_start` time so that any subsequent `toolResult` or `interactiveUi` rows pushed for the same assistant message land BELOW the assistant text in `messages[]`, preserving the model's content-array order in the live render even before the deferred `message_end` arrives.

Specifically: when a `tool_execution_start` event without `parentToolCallId` arrives and `streamingText` is non-empty AND `streamingTextFlushed` is not yet `true` for the current assistant message, the reducer SHALL push a `role:"assistant"` row using the current `streamingText` content, SHALL clear `streamingText` to the empty string, and SHALL set `streamingTextFlushed` to `true` BEFORE pushing the `role:"toolResult"` row.

A `tool_execution_start` carrying `parentToolCallId` (a nested call) pushes no `toolResult` row and SHALL NOT flush.

`streamingTextFlushed` SHALL be reset to `false` on every `message_start` event whose `message.role` is `"assistant"` AND on every `message_end` event whose `message.role` is `"assistant"`. This dual-reset keeps the flag's lifecycle equal to "between message_start and message_end" so a stray `tool_execution_start` arriving outside that window cannot silently no-op the flush.

When `streamingTextFlushed` is `true`, subsequent `message_update` events for the same assistant message SHALL NOT re-populate `next.streamingText` from the message's content array (which would re-show the already-flushed prefix in the streaming bubble below `messages[]`).

When `streamingTextFlushed` is `true` at `message_end` for an assistant message, the reducer SHALL skip the duplicate assistant-row push (the row is already in `messages[]`) and SHALL stamp `data.entryId` and `data.nonce` onto the unstamped flushed row located by `findFlushedAssistantRowIndex`. The existing reorder pass at `message_end` SHALL still run; it will match the flushed assistant row to the message's `text` content block and the `toolResult` row(s) to the `toolCall` content block(s), preserving content-array order.

The `findFlushedAssistantRowIndex` helper SHALL scan `messages[]` from the tail backwards with a hard upper bound: it SHALL stop at the first row whose role is in `TURN_BOUNDARY_ROLES` (`user`, `turnSeparator`, `commandFeedback`, `rawEvent`). This clamp prevents cross-message `entryId` pollution when a prior message's flush row was orphaned (e.g. its `message_end` was dropped by a bridge disconnect): the orphan row stays unstamped rather than being matched by a later message's stamp.

#### Scenario: streaming text flushed when ask_user fires
- **GIVEN** an assistant message with `content: [{type:"thinking"}, {type:"text", text:"I'll ask you which path:"}, {type:"toolCall", id:"t1", name:"ask_user"}]`
- **AND** the live event sequence emits `message_start`, `thinking_end` (pushes thinking row), `message_update` (`streamingText` becomes "I'll ask you which path:"), then `tool_execution_start` (id=t1) BEFORE `message_end`
- **WHEN** `tool_execution_start` is processed
- **THEN** `messages[]` SHALL contain a new `role:"assistant"` row with content `"I'll ask you which path:"` immediately before the new `role:"toolResult"` row for t1
- **AND** `streamingText` SHALL equal `""`
- **AND** `streamingTextFlushed` SHALL be `true`

#### Scenario: ask_user blocking window does not show question above text
- **GIVEN** the conditions of the previous scenario have produced messages tail `[thinking, assistant("I'll ask…"), toolResult(t1, running)]`
- **WHEN** a subsequent `prompt_request` for the same tool execution adds an `interactiveUi` row
- **THEN** the messages tail SHALL be `[thinking, assistant("I'll ask…"), toolResult(t1, running), interactiveUi]`
- **AND** the assistant text bubble SHALL precede the `interactiveUi` card in `messages[]` index order, regardless of how long the user takes to respond and how long `message_end` is deferred

#### Scenario: long-running bash flow keeps order stable across tool_execution_update events
- **GIVEN** an assistant message with `content: [{type:"text", text:"All 63 tests pass..."}, {type:"toolCall", id:"t1", name:"bash"}]`
- **AND** events emit `message_start`, `message_update` (text deltas), `tool_execution_start(t1)`, then a series of `tool_execution_update(t1, ...)` events over a multi-second window
- **WHEN** any `tool_execution_update` event is processed during that window
- **THEN** the messages tail SHALL be `[…, assistant("All 63 tests pass..."), toolResult(t1, running)]` for the entire window
- **AND** `streamingText` SHALL equal `""` and `streamingTextFlushed` SHALL be `true` throughout

#### Scenario: deferred message_end is a no-op duplicate-push when flushed
- **GIVEN** `streamingTextFlushed` is `true` on the current assistant message
- **WHEN** `message_end` for that assistant message arrives (potentially after the user has answered the ask_user)
- **THEN** the reducer SHALL NOT push a second `role:"assistant"` row
- **AND** the reorder pass SHALL run with the existing matching rules and SHALL NOT alter the relative order of the flushed row, the `toolResult` row, and any `interactiveUi` row already present
- **AND** `streamingTextFlushed` SHALL be reset to `false`

#### Scenario: message_end stamps entryId onto flushed row (preserves fork-entryid-accuracy contract)
- **GIVEN** `streamingTextFlushed` is `true` on the current assistant message and the flushed row has `entryId: undefined` and `nonce: undefined`
- **WHEN** `message_end` arrives carrying `data.entryId === "abc-123"` and `data.nonce === "n-42"`
- **THEN** the reducer SHALL stamp `entryId === "abc-123"` and `nonce === "n-42"` onto the flushed row in place
- **AND** no duplicate assistant row SHALL be pushed
- **AND** the externally observable behavior SHALL match the archived scenario *"Assistant ChatMessage gets entryId directly from message_end"* — the assistant ChatMessage carries the correct `entryId` after `message_end`, regardless of whether it was flushed or pushed at `message_end` time

#### Scenario: stamping does not match a flushed row from a prior message (R3 clamp)
- **GIVEN** a prior message's flushed row was orphaned because its `message_end` was never delivered, and a `turnSeparator` (or `user`) row separates it from the current message's flushed row
- **WHEN** the current message's `message_end` arrives carrying its own `entryId`
- **THEN** the stamp helper's backwards scan SHALL stop at the boundary row, leaving the prior orphan row unstamped
- **AND** only the current message's flushed row SHALL receive the new `entryId`

#### Scenario: message_start resets the flush flag
- **GIVEN** `streamingTextFlushed` is `true` from a prior assistant message
- **WHEN** a new `message_start` arrives with `message.role === "assistant"`
- **THEN** `streamingTextFlushed` SHALL be set to `false` so the next streaming text becomes flushable when the next `tool_execution_start` arrives

#### Scenario: tool-only assistant message (no text) does not flush
- **GIVEN** an assistant message with `content: [{type:"toolCall", id:"t1"}]` and no text block
- **AND** `streamingText` is empty when `tool_execution_start` fires
- **WHEN** `tool_execution_start` is processed
- **THEN** the reducer SHALL NOT push an assistant row
- **AND** `streamingTextFlushed` SHALL remain `false`

#### Scenario: replay path is unaffected by flush
- **GIVEN** a replay event sequence where `streamingText` is never populated (no `message_update` events; `message_end` arrives directly with full `data.message.content`)
- **WHEN** `tool_execution_start` events arrive in the replay sequence
- **THEN** the flush helper SHALL be a no-op for every such event (`streamingText` is empty)
- **AND** the existing replay-text fallback at the assistant `message_end` arm and the existing `reorderToolCardsForAssistantMessage` SHALL produce the same output as before this requirement was added

#### Scenario: second tool_execution_start in same message is a no-op
- **GIVEN** an assistant message with `content: [{type:"text"}, {type:"toolCall", id:"t1"}, {type:"toolCall", id:"t2"}]`
- **AND** the first `tool_execution_start(t1)` has flushed `streamingText` (so `streamingTextFlushed === true`)
- **WHEN** `tool_execution_start(t2)` arrives before `message_end`
- **THEN** the flush helper SHALL be a no-op (idempotency guard)
- **AND** the second `toolResult` row SHALL be pushed after the first
- **AND** `message_end`'s reorder pass SHALL produce the trailing slice `[assistant, toolResult(t1), toolResult(t2)]`

#### Scenario: model emits text after toolCall — second text not streamed live
- **GIVEN** an assistant message with `content: [{type:"text", text:"I'll search:"}, {type:"toolCall", id:"t1"}, {type:"text", text:"Done."}]`
- **AND** the first text was flushed at `tool_execution_start(t1)`
- **WHEN** `message_update` events for the second text block ("Done.") arrive
- **THEN** the reducer SHALL NOT re-populate `streamingText` (because `streamingTextFlushed === true`)
- **AND** the user accepts that the second text does not stream visibly during the tool execution

#### Scenario: nested tool_execution_start does not flush
- **GIVEN** `streamingText` is non-empty and `streamingTextFlushed` is `false`
- **WHEN** a `tool_execution_start` carrying `parentToolCallId` arrives
- **THEN** the reducer SHALL NOT push an assistant row
- **AND** `streamingText` and `streamingTextFlushed` SHALL be unchanged
