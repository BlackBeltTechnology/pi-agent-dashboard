## MODIFIED Requirements

### Requirement: Per-session models_list is the dropdown's source of truth

The bridge SHALL push a `models_list` message for its own `sessionId` whenever its `ModelRegistry.getAvailable()` may have changed: at session_start, after handling `credentials_updated`, on `onProvidersChanged` callback (custom-provider discovery completion), and in response to `request_models`. The server SHALL forward each push verbatim to every connected browser via `broadcastToAll`. Browsers SHALL replace `modelsMap[sessionId]` with the received models without disturbing other sessions' entries.

#### Scenario: OAuth provider authenticated
- **WHEN** a user completes OAuth authentication for a provider (e.g. Anthropic)
- **THEN** the server broadcasts `credentials_updated` to every bridge
- **AND** each bridge re-reads `auth.json`, refreshes its `ModelRegistry`, and pushes a fresh `models_list` for its own `sessionId`
- **AND** each browser receives those `models_list` messages and updates `modelsMap[sessionId]` incrementally
- **AND** no other session's `modelsMap` entry is wiped

#### Scenario: API key saved
- **WHEN** a user saves an API key via `PUT /api/provider-auth/api-key`
- **THEN** the server writes `auth.json` and broadcasts `credentials_updated` to every bridge
- **AND** the bridge cycle as above runs for every session
- **AND** the dropdown for every active session reflects the new credential within one bridge round-trip

#### Scenario: Credential removed
- **WHEN** a user removes a provider credential via `DELETE /api/provider-auth/:provider`
- **THEN** the server emits `credentials_updated` and the bridge cycle delivers fresh per-session `models_list` updates
- **AND** the dropdown reflects the removal without any global wipe

#### Scenario: Custom provider added via Settings → LLM Providers
- **WHEN** a user adds a custom provider entry to `~/.pi/agent/providers.json` through a single-provider write (or the retained whole-map write)
- **THEN** the server emits `credentials_updated` to every bridge
- **AND** each bridge runs `reloadProviders` (registers the new provider via `pi.registerProvider(...)`, including async `discoverModels` for its `/v1/models` endpoint)
- **AND** each bridge pushes `models_list` containing the new provider's models for its own `sessionId`
- **AND** every browser's dropdown for every active session updates with the new entries

#### Scenario: Custom provider removed through a single-provider delete
- **WHEN** a user removes a custom provider through a single-provider delete
- **THEN** the server emits `credentials_updated` to every bridge
- **AND** each bridge reloads providers and pushes `models_list` for its own `sessionId`
- **AND** the removed provider's models leave every browser's dropdown without a global wipe

#### Scenario: New session spawn does NOT wipe other sessions' models
- **WHEN** a user spawns a new session and the new pi process's bridge sends its first `providers_list` and `models_list`
- **THEN** the server SHALL NOT broadcast any signal that wipes `modelsMap` globally
- **AND** previously-visited sessions in the browser's `subscribedRef` keep their `modelsMap` entries intact
- **AND** the new session's `models_list` populates `modelsMap[<newSessionId>]` only

