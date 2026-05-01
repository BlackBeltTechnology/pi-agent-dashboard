## Purpose

Client-side state machine that converts a stream of `DashboardEvent` objects into `SessionState` for rendering the chat view. Pure function: `(state, event) → newState`.

## Requirements

### Requirement: Session state structure
The `SessionState` SHALL contain: `messages` (array of `ChatMessage`), `toolCalls` (Map of in-flight tool states), `streamingText` and `streamingThinking` (current assistant output), `isStreaming` (boolean), `model`, `thinkingLevel`, token counters (`tokensIn`, `tokensOut`, `cacheRead`, `cacheWrite`, `cost`), `currentTool`, `status`, `turnStats` (per-turn token breakdown array, max 50), `contextUsage`, and `pendingPrompt`.

### Requirement: User message rendering
A `message_start` event with role `"user"` SHALL create a new `ChatMessage` with `role: "user"`. Text content parts SHALL be concatenated. Image content parts SHALL be extracted into the `images` array.

#### Scenario: User sends text message
- **WHEN** a `message_start` event with `role: "user"` and text content arrives
- **THEN** a new user ChatMessage SHALL be added to `messages`

#### Scenario: User sends message with images
- **WHEN** a `message_start` event with image content parts arrives
- **THEN** the ChatMessage SHALL include the images in its `images` array

#### Scenario: Pending prompt cleared
- **WHEN** a `message_start` with `role: "user"` or `agent_start` arrives
- **THEN** `pendingPrompt` SHALL be cleared to `undefined`

### Requirement: Assistant message streaming
A `message_update` event SHALL accumulate assistant text into `streamingText` and thinking content into `streamingThinking`. A `message_end` event SHALL finalize the message, moving streaming content into a permanent `ChatMessage` and clearing streaming state.

#### Scenario: Streaming text accumulates
- **WHEN** successive `message_update` events arrive with text content
- **THEN** `streamingText` SHALL contain the full accumulated text

#### Scenario: Thinking content tracked separately
- **WHEN** a `message_update` contains a `thinking` content part
- **THEN** `streamingThinking` SHALL accumulate the thinking text

#### Scenario: Message finalized
- **WHEN** a `message_end` event arrives
- **THEN** a permanent assistant ChatMessage SHALL be added to `messages` and streaming state SHALL be cleared

### Requirement: Tool call state machine
A `tool_execution_start` event SHALL create a `ToolCallState` entry with `status: "running"`. A `tool_execution_end` event SHALL update the entry to `status: "complete"` (or `"error"` if `isError` is true) and store the result text.

#### Scenario: Tool starts running
- **WHEN** a `tool_execution_start` event arrives
- **THEN** a new ToolCallState SHALL be created with `status: "running"`, `toolName`, and `args`

#### Scenario: Tool completes successfully
- **WHEN** a `tool_execution_end` event arrives with `isError: false`
- **THEN** the ToolCallState SHALL update to `status: "complete"` with the result

#### Scenario: Tool completes with error
- **WHEN** a `tool_execution_end` event arrives with `isError: true`
- **THEN** the ToolCallState SHALL update to `status: "error"` with the error result

### Requirement: Stats accumulation
A `stats_update` event SHALL add per-turn token usage to the running totals and append a `TurnStat` entry (capped at 50 entries). If `contextUsage` is present, it SHALL update the session's context usage.

#### Scenario: Turn stats recorded
- **WHEN** a `stats_update` event with `turnUsage` arrives
- **THEN** a TurnStat SHALL be appended to `turnStats` and totals SHALL be incremented

#### Scenario: Turn stats capped
- **WHEN** `turnStats` exceeds 50 entries
- **THEN** the oldest entry SHALL be removed

### Requirement: Session compact handling
A `session_compact` event SHALL clear all messages and tool call state, resetting the chat view. This occurs when pi compacts the session history to reclaim context window space.

#### Scenario: Session compacted
- **WHEN** a `session_compact` event arrives
- **THEN** `messages` SHALL be cleared, `toolCalls` SHALL be cleared, and streaming state SHALL be reset

### Requirement: Full replay state reset
When an `event_replay` message is received whose first event has `seq === 1`, the reducer SHALL reset session state to `createInitialState()` before applying the replayed events. This prevents duplicate messages when re-subscribing to a previously-loaded session (e.g. switching back to a session card or reconnecting after a WebSocket drop).

#### Scenario: Full replay resets state
- **WHEN** an `event_replay` arrives with events starting at `seq: 1`
- **THEN** the session state SHALL be reset to `createInitialState()` before reducing the replayed events

#### Scenario: Incremental replay preserves state
- **WHEN** an `event_replay` arrives with events starting at a `seq > 1`
- **THEN** the existing session state SHALL be preserved and the new events SHALL be reduced on top of it

#### Scenario: Empty replay preserves state
- **WHEN** an `event_replay` arrives with an empty events array
- **THEN** the existing session state SHALL be preserved (no reset)

### Requirement: Model select handling
A `model_select` event SHALL update `model` and `thinkingLevel` on the session state.

#### Scenario: Model changed
- **WHEN** a `model_select` event arrives with `model: { provider: "anthropic", id: "claude-4" }`
- **THEN** `model` SHALL be set to `"anthropic/claude-4"`
## Requirements

### Requirement: Flow state tracked in SessionState
The `SessionState` SHALL include a `flowState` field of type `FlowState | null`. `FlowState` SHALL contain: `flowName`, `task`, `status` (running/success/error/aborted), `autonomousMode`, `agents` (ordered map of agent name → `FlowAgentState`), and `flowResult` (set on completion).

#### Scenario: Initial state has no flow
- **WHEN** `createInitialState()` is called
- **THEN** `flowState` SHALL be `null`

### Requirement: Reducer processes flow_started event
When a `flow_started` event is received, the reducer SHALL create a new `FlowState` with the flow name, task, status `"running"`, and pre-populated agent entries (from the `steps` array) in pending status with their `blockedBy` dependencies.

#### Scenario: Flow started creates flow state
- **WHEN** a `flow_started` event with `{ flowName: "research", task: "Find bugs", steps: [{id: "r", agent: "researcher", blockedBy: []}, {id: "d", agent: "developer", blockedBy: ["r"]}] }` is processed
- **THEN** `flowState` SHALL be set with `flowName: "research"`, two agents in pending status, and `developer` SHALL have `blockedBy: ["r"]`

### Requirement: Reducer processes flow_agent_started event
When a `flow_agent_started` event is received, the reducer SHALL update the agent's status to `"running"` and store the config metadata (label, model, card role).

#### Scenario: Agent starts running
- **WHEN** a `flow_agent_started` event with `{ agentName: "researcher", config: { model: "@research", card: { label: "Research" } } }` is processed
- **THEN** the agent's status SHALL be `"running"` and label SHALL be `"Research"`

### Requirement: Reducer processes flow_agent_complete event
When a `flow_agent_complete` event is received, the reducer SHALL update the agent's status to `"complete"` or `"error"` based on the result, and store tokens, duration, summary, and files.

#### Scenario: Agent completes successfully
- **WHEN** a `flow_agent_complete` event with `{ agentName: "researcher", result: { success: true, status: "complete", tokens: { input: 3000, output: 1000 }, duration: 12000 } }` is processed
- **THEN** the agent's status SHALL be `"complete"` with the token and duration values

### Requirement: Reducer processes flow tool call events
When `flow_tool_call` and `flow_tool_result` events are received, the reducer SHALL append them to the agent's `toolHistory` array and update the `recentTools` list (last 3 tool calls).

#### Scenario: Tool call recorded
- **WHEN** a `flow_tool_call` event with `{ agentName: "researcher", toolName: "read", input: { path: "src/foo.ts" } }` is processed
- **THEN** the agent's `toolHistory` SHALL include the entry and `recentTools` SHALL show "read · src/foo.ts"

### Requirement: Reducer processes flow_assistant_text and flow_thinking_text
When `flow_assistant_text` or `flow_thinking_text` events are received, the reducer SHALL append them to the agent's `detailHistory` array for display in the agent detail view.

#### Scenario: Assistant text recorded
- **WHEN** a `flow_assistant_text` event with `{ agentName: "researcher", text: "I found..." }` is processed
- **THEN** the agent's `detailHistory` SHALL include a text entry

### Requirement: Reducer processes flow_loop_iteration event
When a `flow_loop_iteration` event is received, the reducer SHALL update the target agent's `loopIteration` and `loopMax` values.

#### Scenario: Loop iteration tracked
- **WHEN** a `flow_loop_iteration` event with `{ loopTarget: "developer", iteration: 2, maxIterations: 3 }` is processed
- **THEN** the `developer` agent SHALL have `loopIteration: 2` and `loopMax: 3`

### Requirement: Reducer processes flow_complete event
When a `flow_complete` event is received, the reducer SHALL update `flowState.status` to the result status and store the `FlowResult` data for the summary view.

#### Scenario: Flow completes
- **WHEN** a `flow_complete` event with `{ status: "success", flowName: "research", results: {...} }` is processed
- **THEN** `flowState.status` SHALL be `"success"` and `flowState.flowResult` SHALL contain the results

### Requirement: message_end extracts content from message object during replay
When a `message_end` event fires and `streamingText` is empty (as happens during event replay for forked or resumed sessions), the reducer SHALL extract text content from `data.message.content` and create an assistant message. The reducer SHALL NOT fall through to the `turnSeparator` path when the message contains text content.

#### Scenario: Forked session replays last assistant message
- **WHEN** a forked session replays events including a `message_end` with assistant text content
- **AND** no prior `message_update` events populated `streamingText`
- **THEN** the assistant message text is extracted from `data.message.content`
- **AND** an assistant message bubble is rendered in the chat view

#### Scenario: Tool-only turn still shows separator
- **WHEN** a `message_end` fires with no `streamingText`
- **AND** `data.message.content` contains no text (tool-use-only turn)
- **AND** the last message was a `toolResult`
- **THEN** a `turnSeparator` is added (existing behavior preserved)

#### Scenario: Live streaming continues to use streamingText
- **WHEN** a `message_end` fires during live streaming
- **AND** `streamingText` has accumulated text from `message_update` events
- **THEN** the assistant message uses `streamingText` content (existing behavior unchanged)


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
