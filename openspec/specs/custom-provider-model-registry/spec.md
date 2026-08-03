# custom-provider-model-registry Specification

## Purpose
TBD - created by archiving change add-agent-role-model-tools. Update Purpose after archive.
## Requirements
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

### Requirement: The server SHALL read native nested models.json metadata

The dashboard server's `models.json` reader SHALL parse the native Pi nested format
`providers.<provider>.models[]` in `~/.pi/agent/models.json`, in addition to the
existing top-level array and top-level `{ models: [] }` shapes. Each nested model SHALL
be flattened into a custom-model entry stamped with its parent `provider` name and
carrying `id`, `contextWindow`, `maxTokens`, `reasoning`, `thinkingLevelMap`, and
`compat` when present. The file SHALL remain read-only — the dashboard SHALL NOT write
`~/.pi/agent/models.json`. Parsing SHALL be defensive: a malformed provider block SHALL
yield no entries for that block and SHALL NOT throw.

#### Scenario: Nested provider models are read

- **GIVEN** `~/.pi/agent/models.json` contains `providers.newapi.models = [{ id: "glm-5.2", contextWindow: 200000, maxTokens: 65536, reasoning: true, thinkingLevelMap: {...}, compat: {...} }]`
- **WHEN** the server builds its registry
- **THEN** a custom-model entry for `newapi/glm-5.2` SHALL be present carrying `contextWindow: 200000`, `maxTokens: 65536`, `reasoning: true`, the `thinkingLevelMap`, and the `compat` object

#### Scenario: Legacy top-level shapes still work

- **GIVEN** `models.json` is a top-level array (or `{ models: [] }`) of custom-model entries
- **WHEN** the server reads it
- **THEN** those entries SHALL be read exactly as before

#### Scenario: Malformed native block does not break the catalogue

- **GIVEN** `providers.newapi.models` is not an array (or an entry is malformed)
- **WHEN** the server reads `models.json`
- **THEN** the malformed block SHALL contribute no entries
- **AND** the server SHALL NOT throw and other providers/entries SHALL still be read

### Requirement: Native capability metadata SHALL win over discovery fallback

For a custom `provider/id` present in BOTH live `/v1/models` discovery and native
`models.json`, the server registry SHALL merge them at the field level: routing fields
(`baseUrl`, `api`, existence, `oauthCompatible`) SHALL come from discovery, and capability
fields (`contextWindow`, `maxTokens`, `reasoning`, `thinkingLevelMap`, `compat`, `input`,
`cost`) SHALL come from native `models.json` and SHALL override the discovery fallback
floors. `oauthCompatible` SHALL NOT be overridden by native `models.json` (the native
format has no such field; it stays from discovery/built-in `isOauthIncompatible` logic so
the OAuth-incompat filter is not bypassed). A native-only entry (no live discovery match —
e.g. `/v1/models` unavailable or IDs-only) SHALL still surface in the catalogue. A
discovered-only entry SHALL retain its api-typed fallback floors. Built-in pi-ai models
SHALL retain precedence over any custom `provider/id` and SHALL NOT be overridden by a
custom `models.json` entry authored under a built-in provider name.

#### Scenario: Native values override fallback floors

- **GIVEN** discovery returns `newapi/glm-5.2` with fallback ctx `128000` / maxTokens `16384` / `reasoning:false` / `input:["text"]` / zero `cost`
- **AND** native `models.json` declares `newapi/glm-5.2` with ctx `200000` / maxTokens `65536` / `reasoning:true`, a `thinkingLevelMap`, `input:["text","image"]`, and a non-zero `cost`
- **WHEN** the server builds its catalogue
- **THEN** the resulting `newapi/glm-5.2` SHALL report ctx `200000`, maxTokens `65536`, `reasoning:true`, the native `thinkingLevelMap`, the native `input`, and the native `cost`
- **AND** its `baseUrl`/`api`/`oauthCompatible` SHALL come from the discovered provider so the model-proxy can route it

#### Scenario: Native-only entry survives a discovery outage

- **GIVEN** `/v1/models` is unavailable (discovery returns no models for `newapi`)
- **AND** native `models.json` declares `newapi/glm-5.2`
- **WHEN** the server builds its catalogue
- **THEN** `newapi/glm-5.2` SHALL still be present with its native capability metadata
- **AND** its `baseUrl`/`api` SHALL be resolved from `providers.json#providers.newapi`

#### Scenario: Discovered-only model keeps fallback floors

- **GIVEN** discovery returns `newapi/other-model` and native `models.json` has no matching entry
- **WHEN** the server builds its catalogue
- **THEN** `newapi/other-model` SHALL retain its api-typed fallback capability floors

### Requirement: GET /api/models SHALL project native capability metadata without credentials or compat

`GET /api/models` SHALL include the raw `thinkingLevelMap` for custom models that carry
it, alongside the existing `reasoning`, `input`, `contextWindow`, `maxTokens`, and `cost`
fields. The server SHALL NOT derive a `supportedThinkingLevels` list (agent consumers
interpret the raw map; the sole `supportedThinkingLevels` derivation lives in the bridge
extension). The response and any logs SHALL NOT include `apiKey` or other credential
material, and SHALL NOT include the raw `compat` object (carried on the registry model for
proxy request formatting only).

#### Scenario: thinkingLevelMap reaches the introspection response

- **GIVEN** `newapi/glm-5.2` carries a native `thinkingLevelMap` and a native `compat`
- **WHEN** a client calls `GET /api/models`
- **THEN** the `newapi/glm-5.2` row SHALL include the raw `thinkingLevelMap`
- **AND** the row SHALL NOT include a server-derived `supportedThinkingLevels`
- **AND** the row SHALL NOT include `compat`
- **AND** the row SHALL NOT include any credential field

#### Scenario: compat is carried for routing but never serialized to /api/models

- **GIVEN** `newapi/glm-5.2` native entry declares `compat: { thinkingFormat: "deepseek", supportsReasoningEffort: true }`
- **WHEN** the server builds its registry model AND a client calls `GET /api/models` (default and `?annotated=1`)
- **THEN** the built registry model SHALL carry `compat` (so `streamSimple` proxy routing can format requests)
- **AND** neither `/api/models` response variant SHALL contain a `compat` field

