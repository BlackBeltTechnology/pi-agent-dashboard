## RENAMED Requirements

- FROM: `### Requirement: Event rename maps exported for intercept`
- TO: `### Requirement: Event rename maps exported for forwarding`

## MODIFIED Requirements

### Requirement: Bridge captures flow lifecycle events from pi.events
The bridge extension SHALL listen on `pi.events` to every `flow:*` channel in `FLOW_EVENT_MAP` and forward them as `event_forward` messages to the dashboard server with flow-specific `eventType` values. A `flow:*` channel outside that map (e.g. the `flow:list-flows` probe or `flow:run`) is not forwarded, per `catch-all-event-forwarding`.

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

### Requirement: Event rename maps exported for forwarding
The `FLOW_EVENT_MAP` and `SUBAGENT_EVENT_MAP` constants SHALL be exported from `flow-event-wiring.ts` so that `bridge.ts` can merge them into its unified `EVENT_BUS_MAP` and the bridge's per-channel EventBus forwarding can subscribe to their channels.

#### Scenario: Maps importable
- **WHEN** `bridge.ts` imports from `flow-event-wiring.ts`
- **THEN** `FLOW_EVENT_MAP` and `SUBAGENT_EVENT_MAP` SHALL be available as named exports

### Requirement: Remove forwarding loops from flow-event-wiring
The `registerFlowEventListeners` function SHALL remove the `event_forward` sending loops for `FLOW_EVENT_MAP` and `SUBAGENT_EVENT_MAP` channels. Event forwarding for these channels is handled by the bridge's per-channel EventBus subscriptions (see `catch-all-event-forwarding`).

The function SHALL retain its non-forwarding responsibilities:
- Listening to `flow:rediscover` and `flow:complete` to resend `commands_list` and `flows_list` messages

#### Scenario: No duplicate forwarding
- **WHEN** a `flow:flow-started` event is emitted on `pi.events`
- **THEN** only the per-channel EventBus subscription SHALL forward it (not the flow-event-wiring listener)

#### Scenario: Commands and flows refresh preserved
- **WHEN** `flow:rediscover` or `flow:complete` fires
- **THEN** `registerFlowEventListeners` SHALL still resend `commands_list` and `flows_list`
