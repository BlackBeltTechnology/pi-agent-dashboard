## MODIFIED Requirements

### Requirement: OAuth provider registry

The server SHALL derive its registry of OAuth providers from the provider definitions of the pi runtime it depends on — every built-in provider that advertises an OAuth login — not from a hand-maintained set of per-provider flow implementations. Each registry entry SHALL expose the provider id, a display name taken from the provider's own OAuth login name, and a `flowType` of `auth_code` or `device_code`. `flowType` is a UI hint (which pane opens first) drawn from a small static table (`anthropic`, `openai-codex`, `openai`, `openrouter` → `auth_code`; any other id → `device_code`); it SHALL NOT gate which flows a provider may run. `GET /api/provider-auth/providers` SHALL be derived directly from this registry. The registry SHALL exclude `radius` (a per-gateway factory instantiated from pi settings the dashboard does not manage). On pi 0.99.1 the registry SHALL contain exactly: `anthropic`, `openai` (Sign in with ChatGPT), `openai-codex`, `github-copilot`, `openrouter`, `kimi-coding`, `meta`, `xai`.

#### Scenario: List available OAuth providers
- **WHEN** a client requests `GET /api/provider-auth/providers`
- **THEN** the server SHALL return a JSON array of `{ id, name, flowType }` for every registry entry, with `name` taken from the provider's OAuth login name

#### Scenario: Adding a new OAuth handler is the only required change
- **WHEN** the pi runtime the server resolves adds a built-in provider with an OAuth login
- **THEN** that id SHALL appear in `GET /api/provider-auth/providers` after a server restart with no change to dashboard source, with `flowType: "device_code"` unless the static hint table names it
- **AND** no separately maintained provider list exists to update

#### Scenario: radius is excluded
- **WHEN** the resolved pi runtime defines a `radius` provider with an OAuth login
- **THEN** `radius` SHALL NOT appear in `GET /api/provider-auth/providers` or `GET /api/provider-auth/handlers`
- **AND** `POST /api/provider-auth/start` with `{ provider: "radius" }` SHALL return 400

#### Scenario: Removed pi providers do not appear
- **WHEN** the catalogue (`providers_list` from the bridge) reports the union of pi's known providers on pi 0.71+
- **THEN** `google-gemini-cli` and `google-antigravity` SHALL NOT appear in either the catalogue or the handler-id list

### Requirement: Server exposes registered handler ids

The server SHALL expose `GET /api/provider-auth/handlers` returning `{ ids: string[] }` — the list of provider ids the dashboard can drive a login flow for, equal to the OAuth provider registry's id set. Distinct from the catalogue (the union of pi's providers): a catalogue id absent from `ids` is an OAuth provider the UI knows about but the dashboard cannot complete a login for. This endpoint imposes no rendering obligation on the UI.

#### Scenario: Default handler ids
- **WHEN** the server starts against pi 0.99.1
- **THEN** `GET /api/provider-auth/handlers` returns `{ ids }` containing exactly `anthropic`, `openai`, `openai-codex`, `github-copilot`, `openrouter`, `kimi-coding`, `meta`, `xai` in any order

#### Scenario: Catalogue lists provider not in handlers
- **WHEN** the bridge has pushed a catalogue containing `{ id: "custom-llm", hasOAuth: true }` (e.g. from `pi.registerProvider({ oauth: ... })`)
- **AND** `GET /api/provider-auth/handlers` returns ids without `custom-llm`
- **THEN** `GET /api/provider-auth/status` SHALL NOT emit `custom-llm` as an OAuth row, because OAuth rows are built from the registry only
- **AND** `POST /api/provider-auth/start` for `custom-llm` SHALL return 400 with `error: "Unknown OAuth provider: custom-llm"`
