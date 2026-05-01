## MODIFIED Requirements

### Requirement: Assistant content-array order preserved in chat
On every `message_end` event for an assistant message whose `message.content` array contains at least one block of type `toolCall`, the reducer SHALL ensure the rows in `messages[]` corresponding to this message's content blocks appear in the same order as the content array. The reorder SHALL operate over a **turn-boundary anchored window** that includes every row pushed during the current assistant turn (not just rows that map 1:1 to content blocks).

The window is computed by walking `messages[]` backwards from the just-pushed assistant row, including each row whose role is **not** a hard turn boundary, and stopping at the first hard-boundary row. Hard turn boundaries are roles `user`, `turnSeparator`, `commandFeedback`, `rawEvent`. Roles included in the window are `assistant`, `toolResult`, `thinking`, `interactiveUi`, `bashOutput`, and any future row role classified as "belongs to the current turn".

The matching rules are:
- A `text` block matches the `role:"assistant"` row pushed by the same `message_end` (the assistant text bubble).
- A `toolCall` block matches the `role:"toolResult"` row whose `toolCallId` equals the block's `id`. Additionally, when the window contains a `role:"interactiveUi"` row whose `toolCallId` equals the block's `id`, the `toolCall` block claims the **pair** `[toolResult, interactiveUi]` — the `interactiveUi` row is emitted immediately after its parent `toolResult` in the new suffix.
- A `thinking` block matches the `role:"thinking"` row pushed by the corresponding `thinking_end` for this message.
- A content block whose corresponding row is not present in the window at the time `message_end` fires is skipped — no synthetic row is created.

Rows in the window not matched by any content block ("unclaimed rows") SHALL be emitted **after** all claimed rows in their original relative order. This includes free-floating `interactiveUi` rows (no `toolCallId`), `bashOutput`, and any other non-boundary row pushed during the current turn that does not correspond to a content block.

The reorder SHALL operate only on the turn-boundary anchored window; rows outside the window (prior turns) SHALL NOT be touched.

The reorder SHALL be a no-op when `message.content` contains no `toolCall` blocks (text-only or tool-only messages skip the work).

#### Scenario: text-then-toolCall produces text bubble before tool card
- **GIVEN** an assistant message with `content: [{type:"text", text:"Now mark X:"}, {type:"toolCall", id:"t1", name:"edit"}]`
- **AND** the live event sequence emits `message_start`, `message_update` (text deltas), `tool_execution_start` (id=t1), `message_end`
- **WHEN** the reducer processes `message_end`
- **THEN** the trailing slice of `messages[]` for this message SHALL be `[assistant("Now mark X:"), toolResult(t1, running)]` — assistant text bubble first, tool card second

#### Scenario: text-then-toolCall:ask_user produces text bubble before paired tool+ui
- **GIVEN** an assistant message with `content: [{type:"text", text:"I need a decision:"}, {type:"toolCall", id:"t1", name:"ask_user"}]`
- **AND** the live event sequence emits `message_start`, `message_update`, `tool_execution_start` (id=t1), `prompt_request` with `metadata.toolCallId === "t1"`, `message_end`
- **WHEN** the reducer processes `message_end`
- **THEN** the trailing slice SHALL be `[assistant("I need a decision:"), toolResult(t1, running), interactiveUi(pending, toolCallId=t1)]` — text first, then the paired tool+ui in that order

#### Scenario: thinking-text-toolCall:ask_user
- **GIVEN** an assistant message with `content: [{type:"thinking"}, {type:"text"}, {type:"toolCall", id:"t1", name:"ask_user"}]`
- **AND** `thinking_end`, `tool_execution_start`, `prompt_request` (toolCallId=t1) have all fired before `message_end`
- **WHEN** `message_end` fires
- **THEN** the trailing slice SHALL be `[thinking, assistant, toolResult(t1), interactiveUi(t1)]`

#### Scenario: mixed toolCalls — only some are interactive
- **GIVEN** an assistant message with `content: [{type:"text"}, {type:"toolCall", id:"t1", name:"bash"}, {type:"toolCall", id:"t2", name:"ask_user"}]`
- **AND** events fire: `message_update`, `tool_execution_start(t1)`, `tool_execution_start(t2)`, `prompt_request(toolCallId=t2)`, `message_end`
- **WHEN** `message_end` fires
- **THEN** the trailing slice SHALL be `[assistant, toolResult(t1, running), toolResult(t2, running), interactiveUi(t2, pending)]` — `interactiveUi(t2)` pairs with `toolResult(t2)`, NOT with the adjacent `toolResult(t1)`

#### Scenario: prompt_request arrives after message_end (race)
- **GIVEN** an assistant message with `content: [{type:"text"}, {type:"toolCall", id:"t1", name:"ask_user"}]`
- **AND** events fire in order: `message_update`, `tool_execution_start(t1)`, `message_end`, then later `prompt_request(toolCallId=t1)`
- **WHEN** `message_end` fires before `prompt_request`
- **THEN** the post-`message_end` trailing slice SHALL be `[assistant, toolResult(t1, running)]` (no `interactiveUi` row in the window yet — toolCall claims only the toolResult)
- **AND WHEN** the subsequent `prompt_request` fires
- **THEN** `addInteractiveRequest` pushes the `interactiveUi` row immediately after the existing `toolResult` row, producing the final order `[assistant, toolResult(t1), interactiveUi(t1)]` naturally

#### Scenario: free-floating interactiveUi (no toolCallId) trails after claimed rows
- **GIVEN** an assistant message with `content: [{type:"text"}, {type:"toolCall", id:"t1", name:"edit"}]`
- **AND** a free-floating `prompt_request` with NO `metadata.toolCallId` arrives during the message lifecycle (e.g. from architect mode)
- **WHEN** `message_end` fires
- **THEN** the trailing slice SHALL be `[assistant, toolResult(t1), interactiveUi(no-toolCallId)]` — the free-floating row trails after claimed rows in its original relative order. It SHALL NOT be pulled into the toolCall(t1) pair, because `toolCallId` does not match.

#### Scenario: prior-turn rows are untouched by turn-boundary anchor
- **GIVEN** assistant turn N with `[text, toolCall:ask_user]` has fully landed in `messages[]` in correct order `[..., assistant_N, toolResult_N, interactiveUi_N]`, followed by a `user` row (the user's answer / next message), then assistant turn N+1 with `[text, toolCall(t-new)]`
- **WHEN** turn N+1's `message_end` fires and triggers a reorder
- **THEN** the backwards walk from turn N+1's assistant row stops at the `user` row (hard turn boundary), so the window includes ONLY turn N+1's rows
- **AND** rows for turn N (`assistant_N`, `toolResult_N`, `interactiveUi_N`) SHALL remain at their original indices

#### Scenario: turnSeparator is a hard boundary
- **GIVEN** a tool-only assistant turn ends and pushes a `turnSeparator` row, followed by another assistant turn `[text, toolCall:ask_user]`
- **WHEN** the second turn's `message_end` fires
- **THEN** the backwards walk stops at the `turnSeparator` row, so prior tool-only turn rows are NOT in the window and SHALL NOT be moved

#### Scenario: multiple toolCalls preserve content-array order (no interactives)
- **GIVEN** an assistant message with `content: [{type:"text"}, {type:"toolCall", id:"t1"}, {type:"toolCall", id:"t2"}, {type:"toolCall", id:"t3"}]` (no `ask_user`)
- **AND** `tool_execution_start` events for t1, t2, t3 arrive in any order before `message_end`
- **WHEN** `message_end` fires
- **THEN** the trailing slice SHALL be `[assistant, toolResult(t1), toolResult(t2), toolResult(t3)]`, matching content-array order regardless of `tool_execution_start` arrival order — same behavior as before this requirement was modified

#### Scenario: toolCall-then-text faithfully renders tool card before text
- **GIVEN** an assistant message with `content: [{type:"toolCall", id:"t1"}, {type:"text", text:"That's why I called it"}]`
- **WHEN** `message_end` fires after `tool_execution_start` and the text deltas
- **THEN** the trailing slice SHALL be `[toolResult(t1, running), assistant("That's why I called it")]` — the reducer SHALL inherit the model's content-array order, NOT hardcode text-first

#### Scenario: tool-only message is a no-op
- **GIVEN** an assistant message with `content: [{type:"toolCall", id:"t1"}]` and no text block
- **WHEN** `message_end` fires
- **THEN** the trailing slice SHALL be `[toolResult(t1, running)]` exactly as before — no phantom assistant bubble, no reorder

#### Scenario: text-only message is a no-op
- **GIVEN** an assistant message with `content: [{type:"text"}]` and no toolCall blocks
- **WHEN** `message_end` fires
- **THEN** the trailing slice SHALL be `[assistant("text")]` and the reorder helper SHALL exit on the fast path (no toolCall blocks → no window construction)

#### Scenario: empty streamingText with non-empty content text (fork/replay fallback)
- **GIVEN** an assistant `message_end` where `streamingText` is empty but `message.content[0]` is `{type:"text", text:"..."}` (replay-text fallback)
- **AND** content also contains `{type:"toolCall", id:"t1", name:"ask_user"}` and `prompt_request(t1)` has fired
- **WHEN** `message_end` fires and the fallback push lands the assistant bubble in `messages[]`
- **THEN** the reorder helper SHALL still run and produce `[..., assistant(replayText), toolResult(t1), interactiveUi(t1)]`

### Requirement: Live spinner immediacy preserved
The `tool_execution_start` reducer arm SHALL continue to push the `toolResult` row onto `messages[]` immediately, before the parent assistant `message_end` fires. The `prompt_request` arm SHALL continue to push the `interactiveUi` row immediately when the request arrives. The reorder at `message_end` SHALL relocate these rows but SHALL NOT change their identity (`id` field) so React keyed reconciliation preserves the DOM nodes and avoids remount-flicker.

#### Scenario: Tool spinner visible during streaming
- **WHEN** `tool_execution_start` fires for a tool whose parent assistant message is still streaming text
- **THEN** the `toolResult` row appears in `messages[]` immediately with `toolStatus:"running"` so ChatView renders the spinner without waiting for `message_end`

#### Scenario: Interactive dialog visible during streaming
- **WHEN** `prompt_request` fires for an `ask_user` whose parent assistant message is still streaming text
- **THEN** the `interactiveUi` row appears in `messages[]` immediately with `args.status:"pending"` so ChatView renders the dialog without waiting for `message_end`

#### Scenario: DOM nodes preserved across reorder
- **WHEN** the reorder at `message_end` relocates a `toolResult` row from index N to index N-1 (or earlier) AND its paired `interactiveUi` row alongside it
- **THEN** both rows' `id` fields remain `tool-${toolCallId}` and `ui-${requestId}` respectively, so React's keyed reconciliation reuses the existing DOM nodes — the user sees the assistant text bubble appear **above** the running tool+dialog pair without any remount, fade, or spinner reset

## ADDED Requirements

### Requirement: PromptBus carries originating toolCallId in metadata
When a PromptBus adapter emits a `prompt_request` from inside a tool execution, the `prompt_request.metadata.toolCallId` field SHALL be populated with the originating tool call's `id`. The reducer uses this id to pair the resulting `interactiveUi` row with its parent `toolResult` row during the assistant `message_end` reorder.

When the prompt is not bound to a tool execution (e.g. an architect-mode prompt or a free-floating dialog from extension code), the field SHALL be left undefined. The reducer treats such rows as unclaimed-trailing in the reorder.

#### Scenario: ask_user prompt carries toolCallId
- **GIVEN** the bridge's dashboard-default-adapter is invoked from inside an `ask_user` tool execution with `toolCallId === "t1"`
- **WHEN** the adapter emits the `prompt_request` envelope to the dashboard server
- **THEN** the message SHALL include `metadata.toolCallId === "t1"`

#### Scenario: free-floating prompt has no toolCallId
- **GIVEN** an extension calls a PromptBus method outside any tool execution (e.g. from a slash-command handler)
- **WHEN** the resulting `prompt_request` is emitted
- **THEN** the message SHALL omit `metadata.toolCallId` (or leave it undefined)

### Requirement: interactiveUi ChatMessage carries toolCallId
The `addInteractiveRequest` helper SHALL accept an optional `toolCallId` parameter and stamp it onto the pushed `role:"interactiveUi"` ChatMessage when provided. The `useMessageHandler` `prompt_request` arm SHALL extract `msg.metadata?.toolCallId` and forward it to `addInteractiveRequest`.

#### Scenario: prompt_request with toolCallId produces tagged interactiveUi row
- **GIVEN** a `prompt_request` arrives with `metadata.toolCallId === "t1"`
- **WHEN** `useMessageHandler` dispatches it via `addInteractiveRequest`
- **THEN** the pushed `role:"interactiveUi"` ChatMessage SHALL have `toolCallId === "t1"`

#### Scenario: prompt_request without toolCallId produces untagged interactiveUi row
- **GIVEN** a `prompt_request` arrives without `metadata.toolCallId`
- **WHEN** `useMessageHandler` dispatches it
- **THEN** the pushed `role:"interactiveUi"` ChatMessage SHALL have `toolCallId === undefined`
