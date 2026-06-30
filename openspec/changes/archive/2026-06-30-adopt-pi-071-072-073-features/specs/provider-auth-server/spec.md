## MODIFIED Requirements

### Requirement: OAuth provider registry

The server SHALL maintain a registry of OAuth provider handlers. Each handler SHALL expose its provider ID, display name, flow type (`auth_code` or `device_code`), and methods for its specific OAuth flow. The registry of available OAuth providers exposed by `GET /api/provider-auth/providers` SHALL be derived directly from the registered handler set, not from a separately maintained list. Each handler SHALL carry its own `displayName` field. The registry SHALL include handlers for: `anthropic`, `openai-codex`, `github-copilot`. Handlers for `google-gemini-cli` and `google-antigravity` are NOT included — pi 0.71 removed both as built-in providers and the dashboard's UI surfaces them via the catalogue rather than the handler registry.

#### Scenario: List available OAuth providers
- **WHEN** a client requests `GET /api/provider-auth/providers`
- **THEN** the server SHALL return a JSON array of objects, each containing `id`, `name`, and `flowType` for every registered OAuth handler, with `name` taken from the handler's `displayName` field

#### Scenario: Adding a new OAuth handler is the only required change
- **WHEN** a developer registers a new handler in the handler registry with `providerId`, `displayName`, and `flowType`
- **THEN** the new provider SHALL appear in the `GET /api/provider-auth/providers` response without any change to a separate provider list

#### Scenario: Removed pi providers do not appear
- **WHEN** the catalogue (`providers_list` from the bridge) reports the union of pi's known providers on pi 0.71+
- **THEN** `google-gemini-cli` and `google-antigravity` SHALL NOT appear in either the catalogue or the handler-id list

## ADDED Requirements

### Requirement: Server exposes registered handler ids

The server SHALL expose `GET /api/provider-auth/handlers` returning `{ ids: string[] }` — the list of provider ids the dashboard's hand-written handler registry can drive. Distinct from the catalogue (which is the union of pi's providers): a catalogue id without a matching handler id is an OAuth provider the UI knows about but the dashboard cannot complete a login flow for. The UI SHALL render disabled-with-tooltip rows for those gaps.

#### Scenario: Default handler ids
- **WHEN** the server starts with the default handler registry
- **THEN** `GET /api/provider-auth/handlers` returns `{ ids: ["anthropic", "openai-codex", "github-copilot"] }`

#### Scenario: Catalogue lists provider not in handlers
- **WHEN** the bridge has pushed a catalogue containing `{ id: "custom-llm", hasOAuth: true }` (e.g. from `pi.registerProvider({ oauth: ... })`)
- **AND** `GET /api/provider-auth/handlers` returns ids without `custom-llm`
- **THEN** `GET /api/provider-auth/status` SHALL still emit the `custom-llm` OAuth row (UI gates rendering on the handler-id set)
- **AND** `POST /api/provider-auth/authorize` for `custom-llm` SHALL return 400 with `error: "Unknown auth-code provider: custom-llm"` (existing behavior preserved)
