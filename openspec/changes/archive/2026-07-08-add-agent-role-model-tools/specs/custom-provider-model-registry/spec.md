## ADDED Requirements

### Requirement: The dashboard server SHALL register custom providers into its own registry

Custom providers live in `~/.pi/agent/providers.json#providers` (the dashboard's store; pi core never reads it). Every pi session gets them via the globally-registered bridge extension's `pi.registerProvider()`. The dashboard SERVER process is NOT a pi session and does not run that extension, so its `InternalRegistry` custom-provider loop (currently an empty no-op) SHALL be filled: for each `providers.json#providers` entry the server SHALL discover the provider's models (live `/v1/models` fetch), enrich metadata, and register them into `InternalRegistry` with the provider's `baseUrl`/`api`. Result: the server's catalogue matches what pi sessions see.

The server SHALL NOT write `~/.pi/agent/models.json` (pi treats it as user-authored). `providers.json` remains the sole dashboard store for custom providers. No migration of existing config occurs.

#### Scenario: Server registers a custom provider's models

- **GIVEN** `providers.json#providers` contains `bence-proxy` with a reachable `baseUrl`
- **WHEN** the server builds its `InternalRegistry` catalogue
- **THEN** `bence-proxy` models SHALL be present
- **AND** each SHALL carry the provider's `baseUrl` (NOT an empty string) so the model-proxy can route it

#### Scenario: GET /api/models returns custom-provider models

- **GIVEN** custom provider `bence-proxy` in `providers.json`
- **WHEN** a client calls `GET /api/models`
- **THEN** the response SHALL include `bence-proxy` models (previously zero — the server's custom loop was a no-op)

#### Scenario: models.json is never written by the dashboard

- **WHEN** the dashboard registers, discovers, or updates any custom provider
- **THEN** `~/.pi/agent/models.json` SHALL NOT be created or modified by the dashboard
- **AND** any user-authored `models.json` SHALL be left untouched

### Requirement: Server custom-provider discovery SHALL be triggered on provider changes and be atomic

Server-side discovery SHALL run when a provider is added/edited/removed (the server already owns that CRUD via `provider-routes.ts`) and MAY be cached between changes. The server's write of `providers.json#providers` SHALL be atomic (tmp+rename) so concurrent readers never observe a partial file.

#### Scenario: Adding a provider refreshes the server catalogue

- **GIVEN** the server is running
- **WHEN** a user adds a custom provider via the dashboard
- **THEN** the server SHALL discover its models and include them in `GET /api/models` without a restart

#### Scenario: Server provider write is atomic

- **WHEN** the server persists a `providers.json#providers` change
- **THEN** it SHALL write to a temp sibling then rename
- **AND** the file MUST NEVER be observed partially written

### Requirement: pi sessions SHALL continue to receive custom providers via the bridge extension

The extension's per-session `registerProvider()` path (globally registered bridge) is unchanged: interactive sessions, flows, subagents, and standalone `pi` runs continue to get custom providers that way. `preRegisterProviderAuth` SHALL be retained to close the newly-added-provider spawn window (auth available before the ~10s `/v1/models` discovery resolves). The extension SHALL NOT write `models.json`.

#### Scenario: Spawned session resolves a custom-provider model

- **GIVEN** a custom provider in `providers.json` and a role/ref pointing at one of its models
- **WHEN** a flow or subagent session is spawned and resolves that ref
- **THEN** resolution SHALL succeed via the inherited/registered session registry
- **AND** SHALL NOT require the dashboard server to be running
