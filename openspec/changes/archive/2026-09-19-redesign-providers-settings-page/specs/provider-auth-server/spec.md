## ADDED Requirements

### Requirement: Catalogue availability signal

API-key rows in the credential status response exist only while a provider catalogue pushed by a connected pi session is held. The server SHALL expose `GET /api/provider-auth/catalogue-ready` returning `{ ready: boolean }`, so a client can distinguish "no credentials" from "the api-key provider list is unavailable". The route SHALL carry a route-tier entry and SHALL be bound in the MCP tool manifest or explicitly denylisted, on the same terms as every other `/api/*` route.

The held catalogue SHALL be invalidated when the last bridge disconnects. Without that invalidation the signal reports ready forever after the first push and is therefore false.

The signal SHALL NOT be carried as a field of `GET /api/provider-auth/status`, whose body is a bare array that clients pin, nor as a response header.

#### Scenario: No catalogue has been pushed
- **WHEN** no pi session has pushed a catalogue since server start
- **THEN** the endpoint SHALL report `{ ready: false }`

#### Scenario: Api-key rows disappear while the catalogue is unavailable
- **WHEN** the catalogue is unavailable and `auth.json` holds an api-key credential for `openrouter`
- **THEN** `GET /api/provider-auth/status` SHALL emit no api-key row for `openrouter`
- **AND** the row SHALL reappear once a session pushes a catalogue again
- **NOTE** api-key rows exist only within the catalogue loop; the stored credential is untouched, but it is unmanageable from the dashboard until a catalogue is available — an accepted consequence of reporting the signal truthfully

#### Scenario: Catalogue available
- **WHEN** a connected session has pushed a catalogue
- **THEN** the endpoint SHALL report `{ ready: true }`

#### Scenario: Last bridge disconnects
- **WHEN** a catalogue has been pushed and then the last bridge disconnects
- **THEN** the endpoint SHALL report `{ ready: false }`

#### Scenario: Status response shape is unchanged
- **WHEN** a client requests `GET /api/provider-auth/status`
- **THEN** the body SHALL remain a bare JSON array with no added envelope

## MODIFIED Requirements

### Requirement: Credential status API
The server SHALL expose `GET /api/provider-auth/status` returning the authentication status of all providers. For each provider it SHALL return: `id`, `name`, `flowType`, `authenticated` (boolean), and for OAuth providers the `expires` timestamp if authenticated. For API-key providers the response MAY include `envVar` (string, name of the env variable pi-ai consults for this provider) and `ambient` (boolean, true when the provider is configured via an ambient credential chain such as AWS profile or Google ADC). The server SHALL NOT return tokens or secrets.

Each row SHALL additionally carry `configured` (boolean) and, when configured, `source` (the credential's origin as reported by pi's provider catalogue: `"stored"`, `"runtime"`, `"environment"`, `"fallback"`, `"models_json_key"`, or `"models_json_command"`). `configured` answers "does this row hold a usable credential", which `authenticated` does not: `authenticated` reports only a stored credential or an ambient chain, so a provider credentialed by a plain environment variable reports `authenticated: false`. `authenticated` SHALL keep its current meaning for existing consumers.

`configured` SHALL be derived per row kind, from evidence the row itself owns:

- **OAuth row** (`auth_code` / `device_code`): configured when the stored credential for that provider is an OAuth credential.
- **API-key row** (including the `<id>-api` twin emitted alongside an OAuth handler): configured when a stored api-key credential exists for it, OR the provider is ambient, OR the catalogue entry reports it configured with a source that is present and is NOT `"stored"`.

The exclusion of `"stored"` evidence for api-key rows SHALL apply uniformly, not as a special case for the twin: a catalogue entry reports `configured: true, source: "stored"` for **any** stored credential, including an OAuth one, so admitting it would mark a keyless api-key row configured and put a row whose removal destroys an OAuth credential into the connected list. A stored api-key credential is already covered by the row's own stored-key evidence, so nothing is lost.

An absent `source` SHALL NOT qualify as evidence, because a catalogue may report `configured: true` with no source.

The endpoint SHALL answer `200` with a JSON array whenever `auth.json`'s bytes are readable but are not a JSON plain object; corrupt credential content SHALL NOT produce a `5xx`. Every provider SHALL then be reported `authenticated: false`, which is truthful — no credential is readable.

#### Scenario: Mixed authenticated and unauthenticated providers
- **WHEN** `auth.json` contains credentials for `anthropic` and `openai` but not `github-copilot`
- **THEN** the status response SHALL show `authenticated: true` with `expires` for `anthropic`, `authenticated: true` for `openai` (API key, no expiry), and `authenticated: false` for `github-copilot`

#### Scenario: Environment-credentialed provider reports configured
- **WHEN** `OPENAI_API_KEY` is set, `auth.json` has no `openai` entry, and the catalogue reports `openai` as `{ configured: true, source: "environment" }`
- **THEN** the `openai` row SHALL report `configured: true` and `source: "environment"`

#### Scenario: OAuth-credentialed provider's api-key twin is not configured
- **WHEN** `anthropic` holds a stored OAuth credential, no api-key credential exists, and the catalogue reports `anthropic` as `{ configured: true, source: "stored" }`
- **THEN** the `anthropic` OAuth row SHALL report `configured: true`
- **AND** the `anthropic-api` row SHALL report `configured: false`

#### Scenario: Env-var key on a provider that also has an OAuth handler
- **WHEN** `ANTHROPIC_API_KEY` is set, no credential is stored, and the catalogue reports `anthropic` as `{ configured: true, source: "environment" }`
- **THEN** the `anthropic-api` row SHALL report `configured: true` and `source: "environment"`

#### Scenario: Catalogue reports configured with no source
- **WHEN** a catalogue entry reports `configured: true` with no `source`
- **THEN** the corresponding api-key row SHALL NOT be reported configured on that evidence alone

#### Scenario: OAuth row with a stored api-key credential is not configured
- **WHEN** `auth.json` holds an **api_key** credential under `anthropic` and no OAuth credential
- **THEN** the `anthropic` OAuth row SHALL report `configured: false`
- **AND** the `anthropic-api` row SHALL report `configured: true`

#### Scenario: Stored api key reports configured
- **WHEN** the catalogue holds `openrouter` and `auth.json` holds an api-key credential for `openrouter`
- **THEN** its row SHALL report `configured: true` and `source: "stored"`

#### Scenario: API-key row carries envVar hint
- **WHEN** the catalogue's `mistral` entry has `envVar: "MISTRAL_API_KEY"` and `auth.json` has no `mistral` entry
- **THEN** the `mistral` row in the status response SHALL include `envVar: "MISTRAL_API_KEY"` and `authenticated: false`

#### Scenario: Corrupt auth.json returns 200 with all providers unauthenticated
- **WHEN** `auth.json` is empty or truncated and a client requests `GET /api/provider-auth/status`
- **THEN** the server SHALL respond `200` with a JSON array
- **AND** every row SHALL report `authenticated: false`

### Requirement: API key CRUD
The server SHALL expose `PUT /api/provider-auth/api-key` accepting `{ provider, key }` to save an API key credential, and `DELETE /api/provider-auth/:provider` to remove any credential (OAuth or API key). Both SHALL write to `auth.json` atomically with file locking.

A credential write SHALL be **refused** when it would replace an existing credential of a **different type** under the same storage key. Several rows resolve to one storage key — notably an `<id>-api` row and its OAuth sibling both resolve to `<id>` — so without the refusal an api-key save silently destroys a subscription login, and a completed OAuth sign-in silently destroys a stored key. The refusal SHALL apply in both directions, SHALL be reported to the caller rather than swallowed, and SHALL name the existing credential's type and the remove-first path by which the replacement can still be performed deliberately.

The refusal SHALL be enforced at the write path, not only in the user interface, because the write path is reachable by any API client.

**Removal is subject to the same rule.** `DELETE /api/provider-auth/:provider` resolves an `<id>-api` row to the bare id, so a delete addressed to the api-key row would otherwise remove the sibling's OAuth credential. A removal SHALL be refused when the stored credential's type does not match the kind of the row addressed; removing the credential the row actually owns SHALL continue to succeed.

Every refusal — write and removal alike — SHALL carry the single stable machine code `provider_auth.credential_type_conflict`, with `vars` naming the stored credential's type, so the client renders a translated message; English text is retained only as a fallback.

#### Scenario: API-key write over a stored OAuth credential is refused
- **WHEN** `auth.json` holds an OAuth credential for `anthropic` and a client sends `PUT /api/provider-auth/api-key` with `{ provider: "anthropic-api", key: "sk-..." }`
- **THEN** the server SHALL respond `409`
- **AND** the stored OAuth credential SHALL be unchanged
- **AND** the message SHALL name the existing credential's type and the remove-first path

#### Scenario: OAuth completion over a stored API key is refused
- **WHEN** `auth.json` holds an api-key credential for `anthropic` and an OAuth sign-in for `anthropic` completes
- **THEN** the credential SHALL NOT be overwritten
- **AND** the flow SHALL report the refusal on its own surface with the same actionable message

#### Scenario: Remove-first makes the replacement possible
- **WHEN** the existing credential is removed and the write is retried
- **THEN** the write SHALL succeed

#### Scenario: Removing the api-key row does not delete an OAuth credential
- **WHEN** `auth.json` holds an OAuth credential for `anthropic` and a client sends `DELETE /api/provider-auth/anthropic-api`
- **THEN** the removal SHALL be refused
- **AND** the OAuth credential SHALL remain stored

#### Scenario: Removing the credential the row owns succeeds
- **WHEN** `auth.json` holds an api-key credential under `anthropic` and a client sends `DELETE /api/provider-auth/anthropic-api`
- **THEN** the credential SHALL be removed

#### Scenario: Refusal carries a translation code
- **WHEN** a cross-type write or removal is refused
- **THEN** the response SHALL carry `code: "provider_auth.credential_type_conflict"` and `vars` naming the stored credential's type
- **AND** the client SHALL render the translated message for that code rather than the English body text

#### Scenario: Same-type write is unaffected
- **WHEN** an api-key credential is written over an existing api-key credential for the same provider
- **THEN** the write SHALL succeed

#### Scenario: Token refresh is unaffected
- **WHEN** an OAuth token refresh writes a refreshed OAuth credential over the stored OAuth credential
- **THEN** the write SHALL succeed

#### Scenario: Save API key
- **WHEN** a client sends `PUT /api/provider-auth/api-key` with `{ provider: "openai", key: "sk-..." }`
- **THEN** the server SHALL write `{ "openai": { "type": "api_key", "key": "sk-..." } }` to `auth.json` (merging with existing entries) and return `{ ok: true }`

#### Scenario: Remove credential
- **WHEN** a client sends `DELETE /api/provider-auth/anthropic`
- **THEN** the server SHALL remove the `anthropic` key from `auth.json` and return `{ ok: true }`

### Requirement: Credentials updated triggers per-session model refresh
When the server persists a credential change (`PUT /api/provider-auth/api-key`, `DELETE /api/provider-auth/:provider`, OAuth callback success, device-code completion, `PUT /api/providers`, `PATCH /api/providers/:name`, `DELETE /api/providers/:name`), it SHALL broadcast `credentials_updated` to every connected bridge so they reload `auth.json` + `~/.pi/agent/providers.json` and refresh their `ModelRegistry`. Each bridge SHALL then push a fresh per-session `models_list` (and `providers_list`) which the server forwards to browsers via the existing per-session broadcast.

The server SHALL NOT broadcast `models_refreshed` from any path. The previous design used a global broadcast that wiped every browser's `modelsMap` and re-requested only for the currently-selected session, which left previously-visited sessions in `subscribedRef` with empty dropdowns. The per-session `models_list` channel is self-healing without a wipe (see capability `model-refresh`).

The catalogue cache is a read consumer for `GET /api/provider-auth/status`. Its update on `providers_list` arrival is idempotent and unobserved by browsers — the Settings UI re-fetches after each credential write and during sign-in polling. Its invalidation on last-bridge disconnect is reported through the catalogue-availability signal, not through a browser broadcast.

#### Scenario: Refresh after API-key write
- **WHEN** a client writes a new API key via `PUT /api/provider-auth/api-key`
- **THEN** the server SHALL persist the credential, broadcast `credentials_updated` to bridges, and return `{ ok: true }`
- **AND** each bridge SHALL push a fresh `models_list` for its own `sessionId` covering the new credential
- **AND** the server SHALL NOT broadcast `models_refreshed` to browsers

#### Scenario: Refresh after custom provider added
- **WHEN** a client writes a new custom provider via `PUT /api/providers` or a single-provider `PATCH /api/providers/:name`
- **THEN** the server SHALL persist the entry to `~/.pi/agent/providers.json`, broadcast `credentials_updated` to bridges, and return a success body
- **AND** each bridge SHALL run `reloadProviders(pi)` (registering the new provider via `pi.registerProvider(...)` after async `discoverModels`)
- **AND** each bridge SHALL push fresh per-session `models_list` (and `providers_list`) reflecting the new provider's models
- **AND** the server SHALL NOT broadcast `models_refreshed` to browsers

#### Scenario: Refresh after custom provider deleted
- **WHEN** a client removes a custom provider via `DELETE /api/providers/:name`
- **THEN** the server SHALL broadcast `credentials_updated` to bridges
- **AND** each bridge SHALL push fresh per-session `models_list` without the removed provider's models

#### Scenario: providers_list arrival does NOT broadcast
- **WHEN** the bridge for any session sends a `providers_list` (initial connect, fork, resume, reconnect, content change, or response to `request_providers`)
- **THEN** the server SHALL overwrite the cached catalogue snapshot via `setCatalogueForSession`
- **AND** the server SHALL NOT broadcast `models_refreshed` to browsers regardless of whether contents changed

#### Scenario: New session spawn does NOT wipe other sessions' models
- **WHEN** a new pi process spawns and its bridge sends its first `providers_list` and `models_list`
- **THEN** the server SHALL forward `models_list` per-session via `broadcastToAll`
- **AND** the server SHALL update the catalogue cache silently
- **AND** previously-visited sessions in browsers' `subscribedRef` SHALL retain their `modelsMap` entries unchanged

#### Scenario: Stale browser query before refresh completes
- **WHEN** a client polls `GET /api/provider-auth/status` immediately after a write, before the bridge round-trip completes
- **THEN** the response SHALL reflect the previous catalogue plus the just-written `auth.json` change (the server-side `auth.json` masked-key extraction is local and immediate; only the env/ambient fields lag the bridge round-trip)

### Requirement: Bridge notification on credential change
After any credential write (OAuth save, API key save, credential removal, or a single-provider create/update/delete of a custom endpoint in `providers.json`), the server SHALL broadcast a `credentials_updated` message to all connected pi sessions via the pi WebSocket gateway.

#### Scenario: Single-provider custom-endpoint write triggers bridge notification
- **WHEN** a custom endpoint is created, updated, or deleted through a single-provider write
- **THEN** the server SHALL send `{ type: "credentials_updated" }` to all connected bridge extensions

#### Scenario: OAuth login triggers bridge notification
- **WHEN** a user completes OAuth login for Anthropic
- **THEN** the server SHALL send `{ type: "credentials_updated" }` to all connected bridge extensions via the pi gateway

### Requirement: Server exposes registered handler ids

The server SHALL expose `GET /api/provider-auth/handlers` returning `{ ids: string[] }` — the list of provider ids the dashboard's hand-written handler registry can drive. Distinct from the catalogue (which is the union of pi's providers): a catalogue id without a matching handler id is an OAuth provider the UI knows about but the dashboard cannot complete a login flow for. This endpoint imposes no rendering obligation on the UI.

#### Scenario: Default handler ids
- **WHEN** the server starts with the default handler registry
- **THEN** `GET /api/provider-auth/handlers` returns `{ ids: ["anthropic", "openai-codex", "github-copilot"] }`

#### Scenario: Catalogue lists provider not in handlers
- **WHEN** the bridge has pushed a catalogue containing `{ id: "custom-llm", hasOAuth: true }` (e.g. from `pi.registerProvider({ oauth: ... })`)
- **AND** `GET /api/provider-auth/handlers` returns ids without `custom-llm`
- **THEN** `GET /api/provider-auth/status` SHALL emit `custom-llm` as an **api-key** row, because OAuth rows are built from the handler registry and the catalogue contributes api-key rows only
- **AND** `POST /api/provider-auth/authorize` for `custom-llm` SHALL return 400 with `error: "Unknown auth-code provider: custom-llm"` (existing behavior preserved)

