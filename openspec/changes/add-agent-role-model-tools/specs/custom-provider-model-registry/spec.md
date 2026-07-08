## ADDED Requirements

### Requirement: Discovered custom-provider models SHALL be persisted to pi-native `models.json`

After the dashboard discovers a custom provider's models (live `/v1/models` fetch) and enriches their metadata, it SHALL persist them to `~/.pi/agent/models.json` under `providers.<name>.models[]` in pi's documented schema (`{ id, name?, api?, baseUrl?, reasoning, input, cost, contextWindow, maxTokens, headers?, compat? }`), so that pi's `ModelRegistry.create(authStorage, models.json)` loads them synchronously at startup for every consumer (interactive sessions, flows, subagents, and the dashboard server) without any runtime-only injection.

Persistence SHALL be merge-not-clobber and atomic:
- Hand-authored `models.json` entries (providers/models the dashboard did not create) SHALL be preserved untouched.
- Dashboard-managed providers SHALL be identifiable (e.g. marked/namespaced) so re-discovery updates only those.
- Writes SHALL use atomic tmp+rename.

#### Scenario: Discovered custom models land in models.json

- **GIVEN** a custom provider `bence-proxy` configured with a reachable `baseUrl`
- **WHEN** the dashboard discovers its models and persists them
- **THEN** `~/.pi/agent/models.json` SHALL contain `providers["bence-proxy"].models` with the discovered ids and enriched metadata
- **AND** a freshly created `ModelRegistry` SHALL return those models from `getAll()`/`getAvailable()`

#### Scenario: Hand-authored models.json entries are preserved

- **GIVEN** `models.json` already contains a hand-authored provider `ollama` with models
- **WHEN** the dashboard persists a dashboard-managed provider
- **THEN** the `ollama` provider and its models SHALL remain byte-intact
- **AND** only the dashboard-managed provider entry SHALL be added/updated

### Requirement: The dashboard server SHALL read custom models from pi-schema `models.json`

The server's `InternalRegistry` (a bespoke registry, NOT pi's `ModelRegistry`) currently reads a flat top-level `models: []` from `models.json`. It SHALL be reworked to parse pi's canonical schema `{ providers: { <name>: { baseUrl, api, apiKey, models: [...] } } }`, sourcing each model's `baseUrl`/`api` from its provider entry. Without this the server surfaces zero custom models (or models with an empty `baseUrl`) even after they are written. The server's own provider-config write path SHALL be atomic (tmp+rename).

#### Scenario: Server parses pi-schema models.json with non-empty baseUrl

- **GIVEN** `models.json` has `providers["bence-proxy"] = { baseUrl, api, models:[{id}] }`
- **WHEN** the server's `InternalRegistry` composes its catalogue
- **THEN** `bence-proxy` models SHALL be present
- **AND** each SHALL carry the provider entry's `baseUrl` (NOT an empty string)

#### Scenario: GET /api/models returns custom-provider models

- **GIVEN** custom provider `bence-proxy` persisted to `models.json`
- **WHEN** a client calls `GET /api/models`
- **THEN** the response SHALL include `bence-proxy` models (previously zero, because the server read a mismatched schema from an empty `models.json`)

### Requirement: `models.json` writes SHALL be single-owner and change-triggered

Because every pi session runs the extension, an unguarded per-session-startup read-modify-write of `models.json` would let concurrent sessions race and silently drop providers (last-writer-wins). Writes SHALL occur only on a discrete provider add/edit/remove action, owned by a single writer; per-session startup SHALL only READ `models.json`. A newly-added provider's synchronous auth pre-registration (`preRegisterProviderAuth`) SHALL be retained so spawned sessions have provider auth before the ~10s `/v1/models` discovery + `models.json` write complete.

#### Scenario: Concurrent sessions do not drop providers

- **GIVEN** two pi sessions start concurrently with custom providers in `models.json`
- **WHEN** both initialize
- **THEN** neither SHALL rewrite `models.json` on startup
- **AND** no previously-persisted provider SHALL be lost

#### Scenario: Newly-added provider resolves before discovery completes

- **GIVEN** a provider added in the UI whose `/v1/models` discovery has NOT yet completed
- **WHEN** a flow/subagent session is spawned in that window
- **THEN** provider auth SHALL be available (via `preRegisterProviderAuth`)
- **AND** resolution SHALL NOT fail with "No API key found"

#### Scenario: Flows and subagents resolve persisted custom models without an async race

- **GIVEN** a role or literal ref pointing at a custom-provider model already persisted in `models.json`
- **WHEN** a flow or subagent session is spawned and resolves that ref at startup
- **THEN** resolution SHALL succeed from the registry loaded from `models.json`
- **AND** SHALL NOT depend on a live `/v1/models` discovery completing first

### Requirement: A one-time auto-migration SHALL move `providers.json#providers` to `models.json`

The change SHALL ship a migration script that reads `~/.pi/agent/providers.json#providers`, discovers/enriches each provider's models, and persists them in a crash-safe ORDER: (1) back up both files; (2) write `models.json` (merge-not-clobber, atomic) and VERIFY via a fresh `ModelRegistry` that the customs load; (3) ONLY then remove the `providers` key from `providers.json` while preserving `roles`, `rolePresets`, and `activePreset`. On any failure it SHALL restore from backup so custom providers are never lost. The script SHALL be idempotent (no-op when `providers.json` has no `providers` key).

#### Scenario: Migration moves providers and preserves roles

- **GIVEN** `providers.json` contains `providers` (`home-proxy`, `bence-proxy`) AND `roles`/`rolePresets`/`activePreset`
- **WHEN** the migration script runs
- **THEN** `models.json` SHALL contain both providers with their models
- **AND** `providers.json` SHALL retain `roles`/`rolePresets`/`activePreset` and no longer contain `providers`
- **AND** timestamped backups of both files SHALL exist

#### Scenario: Migration is idempotent

- **GIVEN** the migration already ran (no `providers` key in `providers.json`)
- **WHEN** the script runs again
- **THEN** it SHALL detect nothing to migrate and make no changes

#### Scenario: Crash before the strip leaves providers recoverable

- **GIVEN** the migration wrote `models.json` but crashed before stripping `providers.json`
- **WHEN** the user inspects their config
- **THEN** custom providers SHALL still exist (in `models.json` and/or the `providers.json` backup)
- **AND** a re-run SHALL complete the migration idempotently
