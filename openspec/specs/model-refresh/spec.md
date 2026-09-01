# model-refresh Specification

## Purpose
Defines how the dashboard's per-session model selector dropdown stays in sync with each pi process's `ModelRegistry` after credential or provider changes. The contract is "self-healing per-session updates" — every bridge pushes a fresh `models_list` for its own session whenever its registry changes (initial connect, `credentials_updated`, `onProvidersChanged`), and browsers update `modelsMap[sessionId]` incrementally. There is no global wipe and no cross-session broadcast — this prevents previously-visited sessions from losing their dropdown contents when an unrelated session's bridge re-pushes its catalogue.
## Requirements
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
- **WHEN** a user saves a custom provider entry in `~/.pi/agent/providers.json` via `PUT /api/providers`
- **THEN** the server emits `credentials_updated` to every bridge
- **AND** each bridge runs `reloadProviders` (registers the new provider via `pi.registerProvider(...)`, including async `discoverModels` for its `/v1/models` endpoint)
- **AND** each bridge pushes `models_list` containing the new provider's models for its own `sessionId`
- **AND** every browser's dropdown for every active session updates with the new entries

#### Scenario: New session spawn does NOT wipe other sessions' models
- **WHEN** a user spawns a new session and the new pi process's bridge sends its first `providers_list` and `models_list`
- **THEN** the server SHALL NOT broadcast any signal that wipes `modelsMap` globally
- **AND** previously-visited sessions in the browser's `subscribedRef` keep their `modelsMap` entries intact
- **AND** the new session's `models_list` populates `modelsMap[<newSessionId>]` only

### Requirement: models_refreshed is a no-op on the client

The browser-protocol message `models_refreshed` SHALL be accepted by the client without any state mutation — neither wiping `modelsMap`, sending `request_models`, nor any other side effect. The case is retained as a defensive no-op so older bridge builds that may still emit it do not cause runtime errors under strict-union message handling.

#### Scenario: Client receives models_refreshed
- **WHEN** the browser receives a `models_refreshed` message
- **THEN** the client SHALL NOT modify `modelsMap`
- **AND** the client SHALL NOT send `request_models`
- **AND** the client SHALL NOT make any HTTP request

### Requirement: Bridge logs credential reload errors

The bridge SHALL log errors that occur during the `credentials_updated` handler instead of silently ignoring them.

#### Scenario: authStorage reload fails
- **WHEN** the bridge receives `credentials_updated`
- **AND** `authStorage.reload()` throws an error
- **THEN** the error is logged via `console.error` with a `[dashboard]` prefix

#### Scenario: getAvailable fails after reload
- **WHEN** the bridge receives `credentials_updated`
- **AND** `getAvailable()` throws an error
- **THEN** the error is logged via `console.error` with a `[dashboard]` prefix

### Requirement: A refresh that partially fails is reported, not discarded

When the bridge refreshes its `ModelRegistry` in response to `request_models`, it SHALL inspect the refresh outcome rather than discard it. A refresh may report that it was aborted, and may report a per-provider error for any provider it failed to refresh.

A failed refresh SHALL be treated as degraded, not fatal: the bridge SHALL still return the registry's last-known catalogue so the user keeps a usable model list.

For every provider reported as failing, the bridge SHALL log a warning that names that provider and includes the failure text. A bare "refresh failed" without a provider name SHALL NOT satisfy this requirement. An aborted refresh SHALL be logged distinctly from a provider failure.

A refresh that reports neither an abort nor any provider error SHALL produce no warning.

#### Scenario: One provider fails during a requested refresh

- **WHEN** the bridge handles `request_models` and the refresh reports an error for one provider
- **THEN** the bridge SHALL still return a `models_list` containing the last-known catalogue
- **AND** the bridge SHALL log a warning naming that provider and its failure text

#### Scenario: Several providers fail

- **WHEN** the refresh reports errors for more than one provider
- **THEN** the bridge SHALL log a warning for every failing provider, not only the first

#### Scenario: Refresh is aborted

- **WHEN** the refresh reports that it was aborted
- **THEN** the bridge SHALL log that the refresh was aborted
- **AND** the bridge SHALL still return a `models_list`

#### Scenario: Clean refresh logs nothing

- **WHEN** the refresh reports no abort and no provider error
- **THEN** the bridge SHALL emit no refresh warning

#### Scenario: Refresh outcome is unavailable

- **WHEN** the registry's refresh yields no outcome to inspect
- **THEN** the bridge SHALL return a `models_list` as before
- **AND** the bridge SHALL emit no refresh warning

### Requirement: models_list carries provider refresh failures to the browser

The `models_list` message SHALL carry an optional list of provider refresh failures, each identifying the provider and a human-readable failure message. The field SHALL be present only when at least one provider failed to refresh; a clean refresh SHALL omit it entirely so the message is byte-identical to today's on the success path.

An aborted refresh SHALL NOT populate this field: an abort names no failing provider and is a log-level concern only.

The server SHALL forward the field verbatim to every connected browser along with the rest of the message.

#### Scenario: Failures reach the browser

- **WHEN** a bridge pushes a `models_list` after a refresh in which a provider failed
- **THEN** the message SHALL carry that provider and its failure message
- **AND** the browser SHALL receive them unaltered

#### Scenario: Clean refresh omits the field

- **WHEN** a bridge pushes a `models_list` after a refresh with no provider failure
- **THEN** the message SHALL NOT include the refresh-failure field

#### Scenario: Abort does not populate the field

- **WHEN** a bridge pushes a `models_list` after a refresh that was aborted with no provider error
- **THEN** the message SHALL NOT include the refresh-failure field

#### Scenario: Older bridges remain compatible

- **WHEN** the browser receives a `models_list` from a bridge that never sets the refresh-failure field
- **THEN** the browser SHALL process the message without error
- **AND** SHALL render no refresh notice

