# flow-event-bridge Specification

## Purpose

Bridge extension capture + forwarding of pi-flows events. Listens to `flow:*` on `pi.events`, forwards them as `event_forward` messages with flow-specific `eventType` values (carrying nodeKind + failure outcome), sends autonomous-mode state, routes `/flows:delete` through the command path, uses `flow:list-flows` for command detection, and emits inbound `flow:set-edit-mode`. Forwarding loops removed; event rename maps exported for intercept.

## Requirements

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

### Requirement: Lifecycle events carry nodeKind and failure outcome

The bridge's `FLOW_EVENT_MAP` passthrough SHALL preserve the `nodeKind` discriminator (`"agent" | "agent-decision" | "code" | "code-decision" | "fork"`) and the node failure outcome (`"success" | "soft" | "hard"`) on forwarded lifecycle events, so the dashboard can render distinct node cards and soft-vs-hard failure states without re-deriving them. The `flow-ref` kind is removed from the union, matching pi-flows' current `NodeKind`. Per the pi-flows `surface-node-kind` change, `nodeKind` is emitted by every executor, forwarded through the FlowManager seam, and carried inside the event `data` (the dashboard only preserves it; it does not synthesize it).

#### Scenario: nodeKind forwarded
- **WHEN** pi-flows emits `flow:agent-started` / `flow:agent-complete` for a step carrying `nodeKind: "code-decision"` in its `data`
- **THEN** the forwarded `flow_agent_started` / `flow_agent_complete` events SHALL retain `nodeKind: "code-decision"`

#### Scenario: Pre-contract runs lack nodeKind
- **WHEN** a forwarded lifecycle event has no `nodeKind` (a run persisted before `surface-node-kind`)
- **THEN** the passthrough SHALL forward the event unchanged and the dashboard SHALL treat the step as an agent card

#### Scenario: Failure outcome forwarded
- **WHEN** a step completes with a soft failure (routed to `on_error`) or a hard failure (flow halted)
- **THEN** the forwarded completion event SHALL carry the outcome so the card can distinguish soft from hard

#### Scenario: flow-ref kind not part of the contract
- **WHEN** the `nodeKind` discriminator is consumed by the dashboard
- **THEN** `flow-ref` SHALL NOT be a recognized `nodeKind` value

### Requirement: Dashboard emits inbound flow:set-edit-mode

The bridge SHALL accept a dashboard-originated request to set edit-mode and emit `flow:set-edit-mode { enabled }` on `pi.events` for pi-flows to handle (persist `flows.editFlow`, sync skill visibility, reconcile tools, live-reload).

#### Scenario: Edit-mode request forwarded to pi.events
- **WHEN** the dashboard sends a set-edit-mode request with `{ enabled: true }`
- **THEN** the bridge SHALL emit `pi.events.emit("flow:set-edit-mode", { enabled: true })`

#### Scenario: Non-boolean enabled ignored
- **WHEN** a set-edit-mode request arrives without a boolean `enabled`
- **THEN** the bridge SHALL NOT emit the event

