## ADDED Requirements

### Requirement: Bridge captures flow lifecycle events from pi.events
The bridge extension SHALL listen to all `flow:*` events on `pi.events` and forward them as `event_forward` messages to the dashboard server with flow-specific `eventType` values.

The following pi.events → eventType mappings SHALL be used:
- `flow:flow-started` → `flow_started`
- `flow:agent-started` → `flow_agent_started`
- `flow:agent-complete` → `flow_agent_complete`
- `flow:agent-error` → `flow_agent_error`
- `flow:subagent-tool-call` → `flow_tool_call`
- `flow:subagent-tool-result` → `flow_tool_result`
- `flow:assistant-text` → `flow_assistant_text`
- `flow:thinking-text` → `flow_thinking_text`
- `flow:loop-iteration` → `flow_loop_iteration`
- `flow:auto-decision` → `flow_auto_decision`
- `flow:complete` → `flow_complete`

#### Scenario: Flow started event forwarded
- **WHEN** pi-flows emits `flow:flow-started` with `{ flowName, task, steps, description, maxConcurrent }`
- **THEN** the bridge SHALL send an `event_forward` message with `eventType: "flow_started"` and the full event data

#### Scenario: Agent started event forwarded
- **WHEN** pi-flows emits `flow:agent-started` with `{ agentName, stepId, config }`
- **THEN** the bridge SHALL send an `event_forward` message with `eventType: "flow_agent_started"` and the event data

#### Scenario: Agent complete event forwarded
- **WHEN** pi-flows emits `flow:agent-complete` with `{ agentName, stepId, result }`
- **THEN** the bridge SHALL send an `event_forward` message with `eventType: "flow_agent_complete"` and the event data

#### Scenario: Agent error event forwarded
- **WHEN** pi-flows emits `flow:agent-error` with `{ agentName, stepId, text }`
- **THEN** the bridge SHALL send an `event_forward` message with `eventType: "flow_agent_error"` and the event data

#### Scenario: Tool call event forwarded
- **WHEN** pi-flows emits `flow:subagent-tool-call` with `{ agentName, toolName, input }`
- **THEN** the bridge SHALL send an `event_forward` message with `eventType: "flow_tool_call"` and the event data

#### Scenario: Tool result event forwarded
- **WHEN** pi-flows emits `flow:subagent-tool-result` with `{ agentName, toolName, output, isError }`
- **THEN** the bridge SHALL send an `event_forward` message with `eventType: "flow_tool_result"` and the event data

#### Scenario: Flow complete event forwarded
- **WHEN** pi-flows emits `flow:complete` with the full `FlowResult`
- **THEN** the bridge SHALL send an `event_forward` message with `eventType: "flow_complete"` and the result data

#### Scenario: Events only forwarded after session ready
- **WHEN** a `flow:*` event fires before `sessionReady` is true
- **THEN** the bridge SHALL NOT forward the event

### Requirement: Bridge sends autonomous mode state with flow events
The bridge SHALL include the current autonomous mode state when forwarding `flow_started` events. The bridge SHALL listen for autonomous mode toggle events and forward state changes.

#### Scenario: Autonomous mode included in flow started
- **WHEN** a `flow_started` event is forwarded
- **THEN** the event data SHALL include an `autonomousMode: boolean` field reflecting the current state

### Requirement: Bridge emits flows:new-request for /flows:new
The bridge's `sessionPrompt` handler SHALL detect `/flows:new` commands and emit `flows:new-request` event directly instead of falling through to `sendUserMessage`.

#### Scenario: /flows:new with description
- **WHEN** `sessionPrompt` receives `/flows:new design a code review flow`
- **THEN** the bridge SHALL emit `pi.events.emit("flows:new-request", { description: "design a code review flow" })`
- **AND** SHALL NOT call `sendUserMessage`

#### Scenario: /flows:new without description
- **WHEN** `sessionPrompt` receives `/flows:new`
- **THEN** the bridge SHALL emit `pi.events.emit("flows:new-request", { description: "" })`
- **AND** pi-flows' handler SHALL prompt the user for a description via ctx.ui

### Requirement: Bridge emits flows:edit-request for /flows:edit
The bridge's `sessionPrompt` handler SHALL detect `/flows:edit` commands and emit `flows:edit-request` event directly.

#### Scenario: /flows:edit with name
- **WHEN** `sessionPrompt` receives `/flows:edit my-flow`
- **THEN** the bridge SHALL emit `pi.events.emit("flows:edit-request", { flowName: "my-flow" })`
- **AND** SHALL NOT call `sendUserMessage`

#### Scenario: /flows:edit without name
- **WHEN** `sessionPrompt` receives `/flows:edit`
- **THEN** the bridge SHALL emit `pi.events.emit("flows:edit-request", { flowName: "" })`
- **AND** pi-flows' handler SHALL prompt the user to select a flow via ctx.ui

### Requirement: Bridge routes /flows:delete through session.prompt
The bridge's `sessionPrompt` handler SHALL route `/flows:delete` through the standard slash command path (session.prompt or sendUserMessage fallback), allowing pi-flows' registered command handler to execute.

#### Scenario: /flows:delete routed to command handler
- **WHEN** `sessionPrompt` receives `/flows:delete my-flow`
- **THEN** the bridge SHALL NOT handle it specially
- **AND** SHALL route it through the existing slash command pipeline

### Requirement: Bridge uses flow:list-flows for flow command detection
The bridge's `sessionPrompt` handler SHALL use `flow:list-flows` event to determine whether a slash command is a user-defined flow, instead of filtering `pi.getCommands()` by source.

#### Scenario: Flow command detected via flow:list-flows
- **WHEN** `sessionPrompt` receives `/my-custom-flow some task`
- **AND** `flow:list-flows` returns a flow named `my-custom-flow`
- **THEN** the bridge SHALL emit `flow:run` with `{ flowName: "my-custom-flow", task: "some task" }`

#### Scenario: Unknown slash command falls through
- **WHEN** `sessionPrompt` receives `/unknown-cmd args`
- **AND** `flow:list-flows` does NOT include `unknown-cmd`
- **THEN** the bridge SHALL fall through to the existing slash command routing

### Requirement: Remove forwarding loops from flow-event-wiring
The `registerFlowEventListeners` function SHALL remove the `event_forward` sending loops for `FLOW_EVENT_MAP` and `SUBAGENT_EVENT_MAP` channels. Event forwarding for these channels is now handled by the EventBus emit intercept in `bridge.ts`.

The function SHALL retain its non-forwarding responsibilities:
- Listening to `flow:rediscover` and `flow:complete` to resend `commands_list` and `flows_list` messages

#### Scenario: No duplicate forwarding
- **WHEN** a `flow:flow-started` event is emitted on `pi.events`
- **THEN** only the EventBus intercept SHALL forward it (not the flow-event-wiring listener)

#### Scenario: Commands and flows refresh preserved
- **WHEN** `flow:rediscover` or `flow:complete` fires
- **THEN** `registerFlowEventListeners` SHALL still resend `commands_list` and `flows_list`

### Requirement: Event rename maps exported for intercept
The `FLOW_EVENT_MAP` and `SUBAGENT_EVENT_MAP` constants SHALL be exported from `flow-event-wiring.ts` so that `bridge.ts` can merge them into the unified `EVENT_BUS_MAP` used by the emit intercept.

#### Scenario: Maps importable
- **WHEN** `bridge.ts` imports from `flow-event-wiring.ts`
- **THEN** `FLOW_EVENT_MAP` and `SUBAGENT_EVENT_MAP` SHALL be available as named exports

## REMOVED Requirements

### ~~Requirement: flows-mgmt.ts input event interceptor~~
**Removed**: Replaced by direct event emission from bridge sessionPrompt and pi-flows' own registered command handlers. `/flows:new` and `/flows:edit` use event emission; `/flows:delete` routes through session.prompt to pi-flows' handler.
