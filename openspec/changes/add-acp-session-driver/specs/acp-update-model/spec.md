## ADDED Requirements

### Requirement: Typed ACP v2 session-update model
`packages/shared` SHALL export a typed ACP v2 session-update union covering `user_message`, `user_message_chunk`, `agent_message`, `agent_message_chunk`, `agent_thought`, `agent_thought_chunk`, `tool_call_update`, `tool_call_content_chunk`, `state_update`, `plan_update`, `config_option_update`, `available_commands_update`, `usage_update`, `session_info_update`, `terminal_update` and `terminal_output_chunk`, plus an `unknown` passthrough variant. Parsing SHALL NOT throw on malformed or unknown update objects. The module SHALL have no runtime dependency outside `packages/shared`.

#### Scenario: Unknown variant preserved
- **WHEN** a session update arrives with `sessionUpdate: "_querymt_hook_notice"` or an unrecognised non-underscore value
- **THEN** parsing SHALL yield the `unknown` variant carrying the original payload unmodified

#### Scenario: Malformed update tolerated
- **WHEN** an update object lacks `sessionUpdate` or has a wrongly-typed field
- **THEN** parsing SHALL yield the `unknown` variant and SHALL NOT throw

### Requirement: Upsert semantics by id
Applying updates to per-session state SHALL follow v2 patch semantics keyed by `messageId`, `toolCallId` and `planId`: an omitted field leaves the value unchanged, `null` clears it, a concrete value replaces it, and chunk variants append to the entity with the matching id. The first update for an unseen id SHALL create the entity.

#### Scenario: Tool call created then patched
- **WHEN** `tool_call_update { toolCallId: "t1", title: "Read", status: "pending" }` is followed by `tool_call_update { toolCallId: "t1", status: "completed" }`
- **THEN** state SHALL hold one tool call `t1` with title "Read" and status "completed"

#### Scenario: Whole-message upsert resets then chunk appends
- **WHEN** message `m1` has content `[A, B]`, then `agent_message { messageId: "m1", content: [C] }`, then `agent_message_chunk { messageId: "m1", content: D }`
- **THEN** message `m1` content SHALL be `[C, D]`

### Requirement: v1 to v2 normalisation
A per-session normaliser SHALL convert ACP v1 traffic into the v2 model: `tool_call` and `tool_call_update` into `tool_call_update` upserts; message chunks lacking `messageId` into a stable synthetic id per contiguous same-kind run; `plan` into `plan_update { type: "items", planId: "default" }`; `current_mode_update` into `config_option_update` with category `mode`; prompt dispatch into `state_update running`; pending permission into `requires_action` and its answer back into `running`; the v1 `session/prompt` response `stopReason` into `state_update { state: "idle", stopReason }`.

#### Scenario: v1 turn end
- **WHEN** a v1 `session/prompt` request resolves with `{ stopReason: "end_turn" }`
- **THEN** the normaliser SHALL emit exactly one `state_update { state: "idle", stopReason: "end_turn" }`

#### Scenario: v1 chunks without ids
- **WHEN** three `agent_message_chunk` updates without `messageId` arrive, then an `agent_thought_chunk`, then another `agent_message_chunk`
- **THEN** the first three SHALL share one synthetic `messageId`
- **AND** the final chunk SHALL get a different synthetic `messageId`

### Requirement: Synthesis of pi-shaped dashboard events
`packages/shared` SHALL export a stateful per-session adapter converting v2 updates into `DashboardEvent` objects whose `eventType` and `data` shapes match what the existing client reducer and server extractors consume, so ACP sessions render with no reducer change:
- all agent thoughts and messages between segment boundaries (tool-call start, `requires_action`, idle, user message) SHALL form one pi assistant message (thinking and text blocks) emitted as `message_start`, `message_update` carrying the full accumulated `data.message` plus a pi-style `data.assistantMessageEvent` delta (`text_delta`, `thinking_start`, `thinking_delta`, `thinking_end`), and `message_end`, independent of ACP `messageId`s;
- foreground `running` → `agent_start`; `idle` → `turn_end { message }`, `agent_end { messages }`, `agent_settled`;
- stop reasons SHALL map `end_turn`→`stop`, `cancelled`→`aborted`, `max_tokens` and `max_turn_requests`→`length`, `refusal`→`error` with an error message, any other value→`stop` with the original kept in `data.acpStopReason`;
- tool calls → `tool_execution_start` / `tool_execution_update` / `tool_execution_end` (`isError: true` when `failed`); terminal output referenced by a tool call SHALL fold into that tool's updates;
- `requires_action` enter / exit → `ui_prompt_start` / `ui_prompt_end`;
- `model` config option → `model_select` with `data.model = { provider: "acp:<agentId>", id }`; `thought_level` → `model_select` with `data.thinkingLevel` and no `data.model`;
- `plan_update` → one `acp_plan_update` event per change;
- user messages → user-turn events except those the caller marks as suppressed;
- `usage_update`, `available_commands_update`, `session_info_update`, unreferenced terminal output and unknown variants SHALL produce no chat event and SHALL be counted.

#### Scenario: Streamed answer renders in existing chat
- **WHEN** the adapter receives `state_update running`, two `agent_message_chunk` for `m1` ("Hel", "lo"), then `state_update idle end_turn`
- **THEN** it SHALL emit `agent_start`, `message_start`, `message_update` (text "Hel"), `message_update` (text "Hello"), `message_end`, `turn_end`, `agent_end`, `agent_settled` in that order
- **AND** feeding those events to the client reducer SHALL produce one assistant message with text "Hello" and a clean end state

#### Scenario: Thinking streams live
- **WHEN** the adapter receives two `agent_thought_chunk` updates ("a", "b")
- **THEN** the emitted `message_update` events SHALL carry `assistantMessageEvent` thinking deltas "a" and "b"
- **AND** feeding them to the client reducer SHALL show thinking text "ab" before the message ends

#### Scenario: Thought and message with different ids form one bubble
- **WHEN** the adapter receives `agent_thought_chunk { messageId: "th1" }` then `agent_message_chunk { messageId: "m1" }` in the same segment
- **THEN** it SHALL emit a single `message_start` / `message_end` pair whose message holds a thinking block and a text block

#### Scenario: Cancelled turn renders as aborted
- **WHEN** the turn ends with `state_update { state: "idle", stopReason: "cancelled" }`
- **THEN** the emitted final assistant message SHALL carry stop reason `aborted`

#### Scenario: Failed tool
- **WHEN** a tool call `t1` receives `status: "failed"`
- **THEN** the adapter SHALL emit `tool_execution_end` for `t1` with `isError: true`

#### Scenario: Thought level change does not clobber model
- **WHEN** the adapter receives `config_option_update` for a `thought_level` option with value `high`
- **THEN** it SHALL emit `model_select` with `data.thinkingLevel: "high"` and without `data.model`

#### Scenario: Suppressed user echo
- **WHEN** the caller has marked message `u1` as suppressed and the adapter receives `user_message { messageId: "u1" }`
- **THEN** it SHALL emit no user-turn events for `u1`

#### Scenario: High-frequency updates do not flood the chat
- **WHEN** the adapter receives 1 000 `usage_update` updates and 1 000 `terminal_output_chunk` updates not referenced by any tool call
- **THEN** it SHALL emit no chat events for them
