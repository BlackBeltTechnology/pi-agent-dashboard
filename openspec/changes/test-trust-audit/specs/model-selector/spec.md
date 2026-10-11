## MODIFIED Requirements

### Requirement: Role values persist in `"provider/modelId"` form

When `BuiltInRolesSettings` writes a role assignment, the `modelId` field of the `role_set` WebSocket message SHALL be the full `"<provider>/<id>"` string. The bridge extension and pi-flows `role-manager.ts` already pass the `modelId` value through verbatim, so the persisted role entry in `~/.pi/agent/providers.json#roles` SHALL contain the full `"<provider>/<id>"` string after this change lands.

This makes the persisted role value resolvable unambiguously by pi-flows' `flow-engine/execution.ts` — its existing `modelId.split("/")` path picks the provider-aware `modelRegistry.find(provider, id)` branch when `parts.length >= 2`, so the architect agent (which uses `model: @planning`) SHALL find the correct model in the registry.

#### Scenario: Writing a role yields a slash-form value on disk

- **GIVEN** a user assigns the model labeled `proxy/cc/deepseek-v4-flash` to role `planning` via `BuiltInRolesSettings`
- **WHEN** the dashboard finishes its WebSocket round-trip with pi-flows
- **THEN** `~/.pi/agent/providers.json#roles.planning` SHALL equal `"proxy/cc/deepseek-v4-flash"`

#### Scenario: pi-flows resolves the role via the provider-aware path

- **GIVEN** `roles.planning` is `"proxy/cc/deepseek-v4-flash"`
- **WHEN** pi-flows spawns the architect (which declares `model: @planning`)
- **THEN** `resolveModel("@planning", …)` SHALL return `{ modelId: "proxy/cc/deepseek-v4-flash" }`
- **AND** `execution.ts` SHALL call `options.modelRegistry.find("proxy", "cc/deepseek-v4-flash")`
- **AND** the lookup SHALL succeed (assuming the proxy provider is registered and has that model)
- **AND** the architect SHALL spawn against the correct provider's credentials and base URL
