# event-reducer (delta)

## ADDED Requirements

### Requirement: Streaming text flushed at tool_execution_start to preserve content-array order

The reducer SHALL flush a non-empty `streamingText` into a permanent `role:"assistant"` `ChatMessage` row at `tool_execution_start` time so that any subsequent `toolResult` or `interactiveUi` rows pushed for the same assistant message land BELOW the assistant text in `messages[]`, preserving the model's content-array order in the live render even before the deferred `message_end` arrives.

Specifically: when a `tool_execution_start` event arrives and `streamingText` is non-empty AND `streamingTextFlushed` is not yet `true` for the current assistant message, the reducer SHALL push a `role:"assistant"` row using the current `streamingText` content, SHALL clear `streamingText` to the empty string, and SHALL set `streamingTextFlushed` to `true` BEFORE pushing the `role:"toolResult"` row.

`streamingTextFlushed` SHALL be reset to `false` on every `message_start`
event whose `message.role` is `"assistant"`.

When `streamingTextFlushed` is `true`, subsequent `message_update` events for
the same assistant message SHALL NOT re-populate `next.streamingText` from
the message's content array (which would re-show the already-flushed prefix
in the streaming bubble below `messages[]`).

When `streamingTextFlushed` is `true` at `message_end` for an assistant
message, the reducer SHALL skip the duplicate assistant-row push (the row is
already in `messages[]`). The existing reorder pass at `message_end` SHALL
still run; it will match the flushed assistant row to the message's `text`
content block and the `toolResult` row(s) to the `toolCall` content block(s),
preserving content-array order.

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
- **AND** the assistant text bubble SHALL precede the interactiveUi card in `messages[]` index order, regardless of how long the user takes to respond and how long `message_end` is deferred

#### Scenario: deferred message_end is a no-op duplicate-push when flushed
- **GIVEN** `streamingTextFlushed` is `true` on the current assistant message
- **WHEN** `message_end` for that assistant message arrives (potentially after the user has answered the ask_user)
- **THEN** the reducer SHALL NOT push a second `role:"assistant"` row
- **AND** the reorder pass SHALL run with the existing matching rules and SHALL NOT alter the relative order of the flushed row, the `toolResult` row, and any `interactiveUi` row already present (the unclaimed-row guard from `fix-text-tool-render-order` keeps `interactiveUi` at its original index)

#### Scenario: message_end stamps entryId onto flushed row (preserves fork-entryid-accuracy contract)
- **GIVEN** `streamingTextFlushed` is `true` on the current assistant message and the flushed row has `entryId: undefined` and `nonce: undefined`
- **WHEN** `message_end` arrives carrying `data.entryId === "abc-123"` and `data.nonce === "n-42"` (per the archived `fork-entryid-accuracy` requirement that assistant `message_end` carries `entryId` directly via the bridge's `setTimeout(0)` defer)
- **THEN** the reducer SHALL stamp `entryId === "abc-123"` and `nonce === "n-42"` onto the flushed row in place
- **AND** no duplicate assistant row SHALL be pushed
- **AND** the externally observable behavior SHALL match the archived scenario *"Assistant ChatMessage gets entryId directly from message_end"* — the assistant ChatMessage carries the correct `entryId` after `message_end`, regardless of whether it was flushed or pushed at `message_end` time

#### Scenario: stamping does not match a flushed row from a prior message
- **GIVEN** a prior assistant message has already had its flushed row stamped with a real `entryId`
- **AND** a new assistant message has `streamingTextFlushed: true` with its own unstamped flushed row
- **WHEN** the new message's `message_end` arrives
- **THEN** the stamp helper SHALL match the most recent unstamped flushed row only — the prior message's row (already carrying a real `entryId`) SHALL NOT be re-stamped

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
- **AND** the second text SHALL appear in `messages[]` only at `message_end`, ordered after `toolResult(t1)` per the existing reorder rules
- **AND** the user SHALL accept this UX tradeoff: the second text does not stream visibly during the tool execution

### Requirement: Live spinner immediacy preserved (extended)
The existing requirement that `tool_execution_start` push the `toolResult` row immediately SHALL still hold. The flush at `tool_execution_start` SHALL NOT delay the `toolResult` push — both happen in the same reducer call, with the assistant row pushed first and the `toolResult` row pushed second.

#### Scenario: spinner appears immediately after flush
- **WHEN** `tool_execution_start` triggers a flush
- **THEN** the resulting `messages[]` SHALL contain `[…, assistant_flushed, toolResult(running)]` after the same reducer call returns — the spinner is visible to ChatView in the same render cycle as the flushed text bubble
