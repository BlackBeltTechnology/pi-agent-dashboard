# Spec Delta

## ADDED Requirements

### Requirement: Flows plugin bridge declares the flow run channels
The flows plugin bridge SHALL emit `dashboard:register-event-forward` with `pluginId: "flows"` on activation and on every `dashboard:bridge-ready`, declaring the 15 existing flow run channels plus `flow:decision` → `flow_decision`, each with the delivery and key of its channel. Core SHALL NOT map or subscribe any `flow:*` channel itself.

#### Scenario: All flow run channels declared
- **WHEN** the flows plugin bridge activates
- **THEN** its declaration SHALL map these channels with `delivery: "stream"` and `key: "stepId"`: `flow:agent-started` → `flow_agent_started`, `flow:agent-complete` → `flow_agent_complete`, `flow:agent-error` → `flow_agent_error`, `flow:subagent-tool-call` → `flow_tool_call`, `flow:subagent-tool-result` → `flow_tool_result`, `flow:assistant-text` → `flow_assistant_text`, `flow:thinking-text` → `flow_thinking_text`, `flow:loop-iteration` → `flow_loop_iteration`, `flow:decision` → `flow_decision`
- **AND** these with `delivery: "stream"` and `key: "flowName"`: `flow:flow-started` → `flow_started`, `flow:complete` → `flow_complete`
- **AND** this with `delivery: "stream"` and `key: "agentName"`: `flow:auto-decision` → `flow_auto_decision`
- **AND** these with `delivery: "live"` and no key: `flow:summary-started` → `flow_summary_started`, `flow:summary-ready` → `flow_summary_ready`, `flow:summary-dismissed` → `flow_summary_dismissed`, `flow:autonomous-mode-changed` → `flow_autonomous_changed`

#### Scenario: Decision event reaches the dashboard
- **WHEN** pi-flows emits `flow:decision` while the session is ready and connected
- **THEN** the bridge SHALL send an `event_forward` with `eventType: "flow_decision"` and the emitted data

#### Scenario: Declaration repeated on bridge ready
- **WHEN** the main bridge emits `dashboard:bridge-ready` after the flows plugin bridge activated
- **THEN** the flows plugin bridge SHALL emit its declaration again

#### Scenario: Events during a reconnect are retained
- **GIVEN** the bridge connection is down
- **WHEN** pi-flows emits `flow:agent-started` then `flow:agent-complete` for `stepId: "build"`
- **THEN** after reconnect both SHALL be forwarded in emission order

#### Scenario: Flow complete during a reconnect is retained
- **GIVEN** the bridge connection is down
- **WHEN** pi-flows emits `flow:complete` for `flowName: "research"`
- **THEN** after reconnect the bridge SHALL forward one `event_forward` with `eventType: "flow_complete"` for `research`

#### Scenario: Decision during a reconnect is retained
- **GIVEN** the bridge connection is down
- **WHEN** pi-flows emits `flow:decision` for `stepId: "triage"`
- **THEN** the event SHALL be retained under key `triage`
- **AND** after reconnect the bridge SHALL forward one `event_forward` with `eventType: "flow_decision"` and the emitted data

#### Scenario: Keyless summary channel is not retained
- **GIVEN** the session is not ready
- **WHEN** pi-flows emits `flow:summary-ready`
- **THEN** the bridge SHALL NOT forward or retain it

### Requirement: Flows plugin bridge requests a commands resend
The flows plugin bridge SHALL emit `dashboard:commands-changed` when it observes `flow:rediscover` or `flow:complete` on the bus, so the main bridge resends `commands_list`. The core bridge SHALL NOT listen to `flow:rediscover` or `flow:complete` itself.

#### Scenario: Rediscover triggers a commands resend
- **WHEN** pi-flows emits `flow:rediscover`
- **THEN** the flows plugin bridge SHALL emit `dashboard:commands-changed`
- **AND** the main bridge SHALL resend `commands_list` and SHALL NOT send a flow list

#### Scenario: Flow complete triggers a commands resend
- **WHEN** pi-flows emits `flow:complete`
- **THEN** the flows plugin bridge SHALL emit `dashboard:commands-changed`

## MODIFIED Requirements

### Requirement: Event rename maps exported for forwarding
The `SUBAGENT_EVENT_MAP` constant SHALL be exported from `flow-event-wiring.ts` so that `bridge.ts` can merge it into its unified `EVENT_BUS_MAP` and the bridge's per-channel EventBus forwarding can subscribe to its channels. `flow-event-wiring.ts` SHALL NOT export a `FLOW_EVENT_MAP`; flow channels are declared by the flows plugin bridge.

#### Scenario: Maps importable
- **WHEN** `bridge.ts` imports from `flow-event-wiring.ts`
- **THEN** `SUBAGENT_EVENT_MAP` SHALL be available as a named export
- **AND** no `FLOW_EVENT_MAP` export SHALL exist

### Requirement: Lifecycle events carry nodeKind and failure outcome

The flows plugin's declared flow channels SHALL forward event `data` verbatim, preserving the `nodeKind` discriminator (`"agent" | "agent-decision" | "code" | "code-decision" | "fork"`) and the node failure outcome (`"success" | "soft" | "hard"`) on forwarded lifecycle events, so the dashboard can render distinct node cards and soft-vs-hard failure states without re-deriving them. The `flow-ref` kind is removed from the union, matching pi-flows' current `NodeKind`. Per the pi-flows `surface-node-kind` change, `nodeKind` is emitted by every executor, forwarded through the FlowManager seam, and carried inside the event `data` (the dashboard only preserves it; it does not synthesize it).

#### Scenario: nodeKind forwarded
- **WHEN** pi-flows emits `flow:agent-started` / `flow:agent-complete` for a step carrying `nodeKind: "code-decision"` in its `data`
- **THEN** the forwarded `flow_agent_started` / `flow_agent_complete` events SHALL retain `nodeKind: "code-decision"`

#### Scenario: Pre-contract runs lack nodeKind
- **WHEN** a forwarded lifecycle event has no `nodeKind` (a run persisted before `surface-node-kind`)
- **THEN** the declared channel SHALL forward the event unchanged and the dashboard SHALL treat the step as an agent card

#### Scenario: Failure outcome forwarded
- **WHEN** a step completes with a soft failure (routed to `on_error`) or a hard failure (flow halted)
- **THEN** the forwarded completion event SHALL carry the outcome so the card can distinguish soft from hard

#### Scenario: flow-ref kind not part of the contract
- **WHEN** the `nodeKind` discriminator is consumed by the dashboard
- **THEN** `flow-ref` SHALL NOT be a recognized `nodeKind` value

### Requirement: Dashboard emits inbound flow:set-edit-mode

The flows plugin server SHALL accept a dashboard-originated `flow.set-edit-mode` request (`plugin_action` with `pluginId: "flows"`, or `POST /api/plugins/flows/control`) and relay `flow:set-edit-mode { enabled }` into the target session through `ctx.emitEventToSession` only when `enabled` differs from the project's current edit mode (requirement "Explicit per-project edit-mode action" in `flows-edit-mode-settings`), for pi-flows to handle (persist `flows.editFlow`, sync skill visibility, reconcile tools, live-reload). The core bridge SHALL NOT handle a flow-specific edit-mode message.

#### Scenario: Edit-mode request forwarded to pi.events
- **WHEN** the dashboard sends `flow.set-edit-mode` with `{ enabled: true }` while the project's edit mode is off
- **THEN** the flows plugin server SHALL relay it and `flow:set-edit-mode` with `{ enabled: true }` SHALL be emitted on the session's `pi.events`

#### Scenario: Non-boolean enabled ignored
- **WHEN** a `flow.set-edit-mode` request arrives without a boolean `enabled`
- **THEN** the flows plugin server SHALL NOT emit the event

#### Scenario: Same-value edit-mode request emits nothing
- **WHEN** the dashboard sends `flow.set-edit-mode` with `{ enabled: true }` while the project's edit mode is already on
- **THEN** the flows plugin server SHALL NOT emit `flow:set-edit-mode`

## REMOVED Requirements

### Requirement: Bridge captures flow lifecycle events from pi.events
**Reason**: Core no longer maps or forwards `flow:*` channels; `FLOW_EVENT_MAP` is deleted.
**Migration**: The flows plugin bridge declares the channels via `dashboard:register-event-forward`; see "Flows plugin bridge declares the flow run channels". Forwarding now uses `stream` delivery, so events emitted before ready are retained instead of dropped.

### Requirement: Bridge sends autonomous mode state with flow events
**Reason**: Autonomous mode state is pi-flows data, not core bridge behaviour; core no longer forwards any flow channel.
**Migration**: `autonomousMode` rides inside `flow:flow-started` data and `flow:autonomous-mode-changed` is declared by the flows plugin bridge (`flow_autonomous_changed`); both forward verbatim.

### Requirement: Bridge routes /flows:delete through session.prompt
**Reason**: Stale; no core implementation exists. `/flows:delete` is pi-flows' own command and is dispatched like any other extension command.
**Migration**: None.

### Requirement: Remove forwarding loops from flow-event-wiring
**Reason**: `flow-event-wiring` no longer touches flow channels, and the core `flow:rediscover` / `flow:complete` listeners are removed.
**Migration**: The flows plugin bridge emits `dashboard:commands-changed`; see "Flows plugin bridge requests a commands resend".
