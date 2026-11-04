# Spec Delta

## REMOVED Requirements

### Requirement: Flow control REST endpoint
**Reason**: Core holds no flow-specific endpoint; flow commands belong to the flows plugin (BREAKING, noted in CHANGELOG).
**Migration**: Use `POST /api/plugins/flows/control` with `{ sessionId, action }` (`flow.abort`, `flow.toggle-autonomous`, ...). The MCP core tool `flow_control` and bus-client verbs are replaced by the tools generated from the plugin route.
