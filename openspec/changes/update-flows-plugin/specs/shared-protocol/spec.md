# Spec Delta

## MODIFIED Requirements

### Requirement: Flow event types recognized in event forwarding
The event forwarding pipeline SHALL pass through plugin-declared `eventType` values without modification. Core protocol definitions SHALL NOT name any flow event type; the event types forwarded beyond core's own are exactly those declared by plugins through `dashboard:register-event-forward`. The flows plugin SHALL declare the `flow_*` event types (see `flow-event-bridge`).

#### Scenario: Flow events stored and broadcast
- **WHEN** an `event_forward` message has an `eventType` declared by the flows plugin, such as `flow_started`
- **THEN** the server SHALL store it in the memory event store and broadcast it to subscribed browsers as an `EventMessage`

#### Scenario: Core protocol names no flow event type
- **WHEN** `packages/shared/src` protocol sources are inspected
- **THEN** they SHALL NOT contain a `flow_*` event type name

## REMOVED Requirements

### Requirement: Flow control message type in extension protocol
**Reason**: The `flow_control` message and `FlowControlExtensionMessage` are removed from core; flow commands are flows plugin behaviour.
**Migration**: Send `plugin_action` with `pluginId: "flows"` (actions `flow.abort`, `flow.toggle-autonomous`, `flow.dismiss-summary`, `flow.run`, `flow.delete`, `flow.set-edit-mode`), or call `POST /api/plugins/flows/control`.

### Requirement: Flow control message type in browser protocol
**Reason**: The `flow_control` browser message, `FlowControlBrowserMessage` and the `flow_management` message types are removed from core; flow commands are flows plugin behaviour.
**Migration**: Send `plugin_action` with `pluginId: "flows"` (actions `flow.abort`, `flow.toggle-autonomous`, `flow.dismiss-summary`, `flow.run`, `flow.delete`, `flow.set-edit-mode`), or call `POST /api/plugins/flows/control`.
