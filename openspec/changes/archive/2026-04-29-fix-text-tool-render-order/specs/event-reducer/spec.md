## ADDED Requirements

### Requirement: Assistant content-array order preserved in chat
On every `message_end` event for an assistant message whose `message.content` array contains at least one block of type `toolCall`, the reducer SHALL ensure the rows in `messages[]` corresponding to this message's content blocks appear in the same order as the content array.

The matching rules are:
- A `text` block matches the `role:"assistant"` row pushed by the same `message_end` (the assistant text bubble).
- A `toolCall` block matches the `role:"toolResult"` row whose `toolCallId` equals the block's `id` (pushed by the corresponding `tool_execution_start`, which may have arrived before this `message_end`).
- A `thinking` block matches the `role:"thinking"` row pushed by the corresponding `thinking_end` for this message.
- A content block whose corresponding row is not present in `messages[]` at the time `message_end` fires is skipped — no synthetic row is created and no other row is moved on its behalf.

The reorder SHALL operate only on the suffix of `messages[]` containing rows for **this** assistant message; rows from prior or later messages SHALL NOT be touched. Any row in the affected suffix that is not matched by any content block SHALL **retain its original index** within the suffix (so that prior-message rows that happen to fall inside the K-sized window because the current message's content array is wider than the rows actually pushed do not migrate). Claimed rows fill the remaining suffix positions in content-array order.

The reorder SHALL be a no-op when `message.content` contains no `toolCall` blocks (text-only or tool-only messages skip the work).

#### Scenario: text-then-toolCall produces text bubble before tool card
- **GIVEN** an assistant message with `content: [{type:"text", text:"Now mark X:"}, {type:"toolCall", id:"t1", name:"edit"}]`
- **AND** the live event sequence emits `message_start`, `message_update` (text deltas), `tool_execution_start` (id=t1), `message_end`
- **WHEN** the reducer processes `message_end`
- **THEN** the trailing slice of `messages[]` for this message SHALL be `[assistant("Now mark X:"), toolResult(t1, running)]` — assistant text bubble first, tool card second

#### Scenario: multiple toolCalls preserve content-array order
- **GIVEN** an assistant message with `content: [{type:"text"}, {type:"toolCall", id:"t1"}, {type:"toolCall", id:"t2"}, {type:"toolCall", id:"t3"}]`
- **AND** `tool_execution_start` events for t1, t2, t3 arrive in any order (e.g. t3, t1, t2) before `message_end`
- **WHEN** `message_end` fires
- **THEN** the trailing slice SHALL be `[assistant, toolResult(t1), toolResult(t2), toolResult(t3)]`, matching content-array order regardless of `tool_execution_start` arrival order

#### Scenario: toolCall-then-text faithfully renders tool card before text
- **GIVEN** an assistant message with `content: [{type:"toolCall", id:"t1"}, {type:"text", text:"That's why I called it"}]` (rare; faithful to model output)
- **WHEN** `message_end` fires after `tool_execution_start` and the text deltas
- **THEN** the trailing slice SHALL be `[toolResult(t1, running), assistant("That's why I called it")]` — the reducer SHALL NOT hardcode text-first; it SHALL inherit the model's content-array order

#### Scenario: thinking block included in reorder
- **GIVEN** an assistant message with `content: [{type:"thinking"}, {type:"text"}, {type:"toolCall", id:"t1"}]`
- **AND** `thinking_end` has already pushed the thinking bubble before `message_end`
- **WHEN** `message_end` fires
- **THEN** the trailing slice SHALL be `[thinking, assistant, toolResult(t1)]`

#### Scenario: tool-only message is a no-op
- **GIVEN** an assistant message with `content: [{type:"toolCall", id:"t1"}]` and no text block
- **WHEN** `message_end` fires
- **THEN** the trailing slice SHALL be `[toolResult(t1, running)]` exactly as before this requirement was added — the reducer SHALL NOT push a phantom assistant bubble, SHALL NOT alter existing rows, and the reorder helper SHALL exit on the fast path

#### Scenario: text-only message is a no-op
- **GIVEN** an assistant message with `content: [{type:"text"}]` and no toolCall blocks
- **WHEN** `message_end` fires
- **THEN** the trailing slice SHALL be `[assistant("text")]` and the reorder helper SHALL NOT run (fast path skip when no toolCall blocks present)

#### Scenario: tool cards from prior messages are untouched
- **GIVEN** assistant message A with `[text, toolCall(t1)]` has fully landed in `messages[]` in correct order `[assistant_A, toolResult(t1)]`
- **AND** later, assistant message B with `[text, toolCall(t2)]` arrives
- **WHEN** B's `message_end` fires and triggers a reorder
- **THEN** rows for A (`assistant_A`, `toolResult(t1)`) SHALL remain at their original indices; only B's suffix is reordered

#### Scenario: tool_execution_start arriving after message_end
- **GIVEN** an assistant message whose `message_end` fires **before** any `tool_execution_start` (e.g. a synthetic replay path that emits message_end first)
- **WHEN** `message_end` fires
- **THEN** the reorder helper finds no `toolResult` row to relocate and is a no-op for the toolCall block; any prior-message rows that fall inside the K-sized suffix window SHALL retain their original indices (the unclaimed-row guard keeps a prior `user` / `assistant` / `toolResult` row at its original position rather than appending it at the tail)
- **AND WHEN** the subsequent `tool_execution_start` fires
- **THEN** the new tool card is pushed after the already-placed assistant bubble, preserving content-array order naturally

#### Scenario: empty streamingText with non-empty content text (fork/replay fallback)
- **GIVEN** an assistant message_end where `streamingText` is empty but `message.content[0]` is `{type:"text", text:"..."}` (the existing replay-text fallback at the assistant `message_end` arm)
- **AND** content also contains `{type:"toolCall", id:"t1"}`
- **WHEN** `message_end` fires and the fallback push lands the assistant bubble in `messages[]`
- **THEN** the reorder helper SHALL still run and produce `[..., assistant(replayText), toolResult(t1)]`

### Requirement: Live spinner immediacy preserved
The `tool_execution_start` reducer arm SHALL continue to push the `toolResult` row onto `messages[]` immediately, before the parent assistant `message_end` fires. The reorder at `message_end` SHALL relocate the row but SHALL NOT change its identity (`id` field) so React keyed reconciliation preserves the DOM node and avoids remount-flicker.

#### Scenario: Tool spinner visible during streaming
- **WHEN** `tool_execution_start` fires for a tool whose parent assistant message is still streaming text
- **THEN** the `toolResult` row appears in `messages[]` immediately with `toolStatus:"running"` so ChatView renders the spinner without waiting for `message_end`

#### Scenario: DOM node preserved across reorder
- **WHEN** the reorder at `message_end` relocates a `toolResult` row from index N to index N+1 (or later)
- **THEN** the row's `id` field remains `tool-${toolCallId}` so React's keyed reconciliation reuses the existing DOM node — the user sees the assistant text bubble appear **above** the running tool card without the tool card remounting or losing its spinner state
