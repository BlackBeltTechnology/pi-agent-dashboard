# Spec Delta

## REMOVED Requirements

### Requirement: Bridge listens to flow events on pi.events
**Reason**: Core no longer maps or forwards `flow:*` channels; `FLOW_EVENT_MAP` is deleted.
**Migration**: The flows plugin bridge declares the flow run channels via `dashboard:register-event-forward` (see `flow-event-bridge` "Flows plugin bridge declares the flow run channels"). Without pi-flows or with the flows plugin disabled, no flow channel is declared and the bridge runs unchanged.

### Requirement: Bridge handles flow_control messages from server
**Reason**: The `flow_control` message type and its bridge dispatch are removed from core (BREAKING).
**Migration**: Send `plugin_action { pluginId: "flows", action: "flow.abort" | "flow.toggle-autonomous" }`; the flows plugin server relays `flow:abort` + `flow:architect-abort` or `flow:toggle-autonomous` through `ctx.emitEventToSession`, delivered by the generic `plugin_emit_event` bridge path.
