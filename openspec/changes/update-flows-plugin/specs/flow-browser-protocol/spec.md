# Spec Delta

## REMOVED Requirements

### Requirement: Flow control messages from browser to server
**Reason**: Core no longer defines flow-specific browser messages; `flow_control` (and `flow_management`) are removed from the browser protocol, gateway, scope and tier tables (BREAKING). An old tab sending `flow_control` is rejected as an unknown type.
**Migration**: Send `{ type: "plugin_action", pluginId: "flows", sessionId, action: "flow.abort" | "flow.toggle-autonomous" | "flow.dismiss-summary" | "flow.run" | "flow.delete" | "flow.set-edit-mode" }`; the flows plugin server handles it.
