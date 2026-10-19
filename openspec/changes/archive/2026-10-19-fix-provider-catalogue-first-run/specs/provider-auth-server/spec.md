## MODIFIED Requirements

### Requirement: Credentials updated triggers per-session model refresh
When the server persists a credential change (`PUT /api/provider-auth/api-key`, `DELETE /api/provider-auth/:provider`, OAuth callback success, device-code completion, `PUT /api/providers`, `PATCH /api/providers/:name`, `DELETE /api/providers/:name`), it SHALL broadcast `credentials_updated` to every connected bridge so they reload `auth.json` + `~/.pi/agent/providers.json` and refresh their `ModelRegistry`. Each bridge SHALL then push a fresh per-session `models_list` (and `providers_list`) which the server forwards to browsers via the existing per-session broadcast.

The server SHALL NOT broadcast `models_refreshed` from any path. The previous design used a global broadcast that wiped every browser's `modelsMap` and re-requested only for the currently-selected session, which left previously-visited sessions in `subscribedRef` with empty dropdowns. The per-session `models_list` channel is self-healing without a wipe (see capability `model-refresh`).

The catalogue cache is a read consumer for `GET /api/provider-auth/status`. Its update on a non-empty `providers_list` arrival is idempotent and unobserved by browsers. An arrival carrying an empty provider list is ignored (see "API key provider registry") and logged once per session at debug level, so a bridge stuck pushing `[]` is diagnosable — the Settings UI re-fetches after each credential write and during sign-in polling. Its invalidation on last-bridge disconnect is reported through the catalogue-availability signal, not through a browser broadcast.

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
- **THEN** the server SHALL overwrite the cached catalogue snapshot via `setCatalogueForSession` when the pushed provider list is non-empty, and SHALL keep the previous snapshot when it is empty
- **AND** the server SHALL NOT broadcast `models_refreshed` to browsers regardless of whether contents changed

#### Scenario: New session spawn does NOT wipe other sessions' models
- **WHEN** a new pi process spawns and its bridge sends its first `providers_list` and `models_list`
- **THEN** the server SHALL forward `models_list` per-session via `broadcastToAll`
- **AND** the server SHALL update the catalogue cache silently
- **AND** previously-visited sessions in browsers' `subscribedRef` SHALL retain their `modelsMap` entries unchanged

#### Scenario: Stale browser query before refresh completes
- **WHEN** a client polls `GET /api/provider-auth/status` immediately after a write, before the bridge round-trip completes
- **THEN** the response SHALL reflect the previous catalogue (or the runtime fallback when no bridge catalogue is held) plus the just-written `auth.json` change (the server-side `auth.json` masked-key extraction is local and immediate; only the env/ambient fields lag the bridge round-trip)

### Requirement: API key provider registry
The server SHALL derive the list of API-key providers from a provider catalogue, NOT from a hardcoded array. The catalogue SHALL be chosen by this precedence:

1. **Bridge catalogue** — the most recently received bridge-pushed provider catalogue (`providers_list` message), cached per pi process. A push with an empty provider list SHALL NOT replace a held catalogue and SHALL NOT count as held. A real catalogue is never empty (pi always ships built-in providers); the only empty push is from a bridge that has not yet captured its model registry. While a bridge catalogue is held it SHALL be the only source.
2. **Runtime fallback catalogue** — while no bridge catalogue is held, the server SHALL derive a catalogue from its own pi model runtime. This is the same `@earendil-works/pi-coding-agent` runtime that supplies the OAuth registry and `GET /api/models`. The server SHALL read it only through that package's public model-runtime surface and SHALL NOT import `@earendil-works/pi-ai`.
3. **Empty** — while neither is available (no bridge catalogue, and the runtime failed to load, deriving the fallback failed, or `auth.json` exists but cannot be parsed), the API-key portion SHALL be empty. A failure to derive the fallback SHALL NOT fail the status request. The OAuth portion SHALL still be returned.

On a bridge-catalogue miss the server SHALL still proactively send `request_providers` to every connected bridge, whichever source answers the request.

The runtime fallback catalogue SHALL contain one entry per provider the runtime exposes:
- `id`: the provider id;
- `displayName`: the provider's display name, or its id when the name is absent;
- `hasOAuth`: `true` iff the provider offers an OAuth login;
- `configured`, `source`, `authLabel`: derived from the runtime's per-provider auth check. That check SHALL NOT refresh OAuth tokens or write any credential.
  - No check result: `configured: false`, no source.
  - Check result reporting an OAuth credential: `configured: false`. A stored OAuth credential is not api-key evidence.
  - Otherwise, if `auth.json` holds a credential for the id: `configured: true`, `source: "stored"`.
  - Otherwise: `configured: true`, `source: "environment"`, and `authLabel` equal to the check's source text when non-empty;
- `envVar`: the first comma-separated name in the auth label that is an environment-variable name (upper-case letters, digits and underscores, starting with a letter) AND is set in the server's own environment; otherwise absent;
- `ambient`: never set. An ambient chain whose auth check names an environment variable (for example Bedrock via `AWS_PROFILE`) therefore reports as an env-var row (`configured`, not `authenticated`) until a bridge catalogue arrives;
- `custom`: `true` for ids configured in the dashboard's own custom-provider configuration (`~/.pi/agent/providers.json`). This matches the bridge catalogue's `custom` flag, so such ids produce no API-key row. While `providers.json` cannot be parsed, no id is marked `custom`.

The fallback catalogue SHALL be derived when a request is served and SHALL NOT be cached as if it were a bridge catalogue. A bridge push SHALL replace it at once. When the bridge catalogue is invalidated (see "Catalogue availability signal"), the fallback SHALL serve again.

Every entry in the selected catalogue SHALL be mapped as follows:

- If the catalogue id collides with a registered OAuth handler's `providerId`, the API-key row SHALL use the suffixed UI id `${id}-api`, the suffixed display name `${displayName} (API Key)`, and an `authJsonKey` equal to the unsuffixed catalogue id.
- If the catalogue id has no OAuth handler counterpart, the API-key row SHALL use the bare id and bare display name, with `authJsonKey` equal to the id.

The server SHALL pass the catalogue's `envVar` and `ambient` fields straight through to the corresponding `ProviderAuthStatus` rows. When `ambient: true`, the server SHALL force `authenticated: true` and `maskedKey: "(ambient)"` even when `auth.json` has no entry for `authJsonKey`.

#### Scenario: Catalogue from bridge defines the API-key list
- **WHEN** the bridge has pushed `providers_list` containing 25 entries (anthropic, deepseek, fireworks, ...)
- **AND** a client requests `GET /api/provider-auth/status`
- **THEN** the response SHALL include one row per entry, with `flowType: "api_key"` for non-OAuth ids and the `<id>-api` suffix for OAuth-collision ids

#### Scenario: OAuth/API-key collision uses suffixed id
- **WHEN** the catalogue contains an entry with `id: "anthropic"` and `hasOAuth: true`
- **AND** the OAuth handler set contains a handler with `providerId: "anthropic"`
- **THEN** the status response SHALL contain two distinct rows: one OAuth row with `id: "anthropic"`, `name: "Anthropic (Claude Pro/Max)"`, `flowType: "auth_code"` (from the handler), and one API-key row with `id: "anthropic-api"`, `name: "Anthropic (API Key)"`, `flowType: "api_key"`, `authJsonKey: "anthropic"`

#### Scenario: Provider with no OAuth uses bare id
- **WHEN** the catalogue contains an entry with `id: "deepseek"`, `hasOAuth: false`
- **THEN** the status response SHALL contain one row with `id: "deepseek"`, `flowType: "api_key"`, `authJsonKey: "deepseek"`

#### Scenario: Env-var hint surfaces from catalogue
- **WHEN** the catalogue's `openai` entry has `envVar: "OPENAI_API_KEY"`
- **THEN** the corresponding row in the status response SHALL include `envVar: "OPENAI_API_KEY"`

#### Scenario: Ambient credentials marked authenticated
- **WHEN** the catalogue's `google-vertex` entry has `ambient: true`
- **THEN** the row SHALL have `authenticated: true`, `ambient: true`, and `maskedKey: "(ambient)"` regardless of `auth.json` contents

#### Scenario: Catalogue not yet received
- **WHEN** the server has not received any `providers_list` from any bridge
- **AND** the server's model runtime loaded and exposes providers including `deepseek` (no OAuth) and `anthropic` (OAuth)
- **AND** `auth.json` is empty
- **THEN** `GET /api/provider-auth/status` SHALL include an unauthenticated API-key row `deepseek` and an API-key row `anthropic-api`, alongside the OAuth rows
- **AND** the server SHALL have proactively sent `request_providers` to all connected bridges

#### Scenario: Key saved against a fallback row is reported
- **WHEN** no bridge catalogue is held and the runtime fallback serves the list
- **AND** an API key for `deepseek` is saved through the API-key CRUD route
- **THEN** the next `GET /api/provider-auth/status` SHALL report the `deepseek` row with `authenticated: true`, `configured: true`, `source: "stored"` and a masked key

#### Scenario: Fallback env-var hint derives from the auth label
- **WHEN** the runtime fallback serves the list
- **AND** `OPENAI_API_KEY` is set in the server's environment and `auth.json` holds nothing for `openai`
- **THEN** the `openai` row SHALL carry `envVar: "OPENAI_API_KEY"`, `configured: true` and `source: "environment"`
- **AND** SHALL NOT be reported `authenticated` (same as an env-var row from the bridge)
- **AND** an unconfigured fallback row SHALL carry no `envVar`

#### Scenario: Fallback derivation failure degrades to an empty api-key portion
- **WHEN** no bridge catalogue is held and listing the runtime's providers throws
- **THEN** `GET /api/provider-auth/status` SHALL respond 200 with the OAuth rows and no api-key rows

#### Scenario: Empty bridge push does not mask the fallback
- **WHEN** no bridge catalogue is held, the runtime fallback is available, and a bridge pushes `providers_list` with an empty provider list
- **THEN** the status response SHALL still be derived from the runtime fallback
- **AND** the server SHALL keep sending `request_providers` on later status requests

#### Scenario: Custom providers are excluded from fallback API-key rows
- **WHEN** the runtime fallback serves the list
- **AND** `~/.pi/agent/providers.json` defines a custom provider `my-llm` that the runtime also exposes
- **THEN** the status response SHALL contain no API-key row for `my-llm`

#### Scenario: Bridge catalogue takes precedence over the fallback
- **WHEN** the runtime fallback was serving the list
- **AND** a bridge pushes a `providers_list` that contains an extension-registered provider `custom-llm` the runtime does not expose
- **THEN** the next status response SHALL be derived from the bridge catalogue alone and SHALL include a `custom-llm` row

#### Scenario: Neither source available
- **WHEN** no bridge catalogue is held and the server's model runtime failed to load
- **THEN** the API-key portion of the status response SHALL be an empty array, the OAuth portion SHALL still be returned, and the server SHALL have proactively sent `request_providers` to all connected bridges

#### Scenario: Extension-registered provider appears
- **WHEN** another pi extension calls `pi.registerProvider("custom-llm", ...)` and the bridge pushes a fresh `providers_list`
- **THEN** the server cache SHALL be updated and a `custom-llm` row (or `custom-llm-api` if the OAuth handler set grows) SHALL appear in the next `GET /api/provider-auth/status` response without any server restart

### Requirement: Catalogue availability signal

API-key rows in the credential status response come from a bridge catalogue when one is held, otherwise from the runtime fallback catalogue (see "API key provider registry"). The server SHALL expose `GET /api/provider-auth/catalogue-ready` returning `{ ready: boolean, fallback: boolean }`, so a client can tell three cases apart: "no credentials", "the api-key list is the server's built-in fallback", and "the api-key provider list is unavailable".

- `ready` SHALL be `true` iff a bridge catalogue is held. Its meaning is unchanged.
- `fallback` SHALL be `true` iff `ready` is `false` and the runtime fallback catalogue holds at least one entry that is not `custom`, i.e. at least one api-key row can be derived from it. `fallback` SHALL be `false` whenever `ready` is `true`.

The endpoint SHALL wait for the same provider-registry readiness as `GET /api/provider-auth/status` before it answers. During server start-up it SHALL therefore not report `fallback: false` merely because the runtime has not finished loading.

The route SHALL carry a route-tier entry and SHALL be bound in the MCP tool manifest or explicitly denylisted, on the same terms as every other `/api/*` route. The `fallback` field is additive: a client that reads only `ready` keeps its previous behaviour.

The held bridge catalogue SHALL be invalidated when the last bridge disconnects. Without that invalidation the signal reports ready forever after the first push and is therefore false.

The signal SHALL NOT be carried as a field of `GET /api/provider-auth/status`, whose body is a bare array that clients pin, nor as a response header.

#### Scenario: No catalogue has been pushed
- **WHEN** no pi session has pushed a catalogue since server start
- **AND** the server's model runtime loaded and exposes providers
- **THEN** the endpoint SHALL report `{ ready: false, fallback: true }`

#### Scenario: No catalogue has been pushed and the runtime is unavailable
- **WHEN** no pi session has pushed a catalogue since server start
- **AND** the server's model runtime failed to load
- **THEN** the endpoint SHALL report `{ ready: false, fallback: false }`

#### Scenario: Api-key rows disappear while the catalogue is unavailable
- **WHEN** no bridge catalogue is held, the runtime failed to load, and `auth.json` holds an api-key credential for `openrouter`
- **THEN** `GET /api/provider-auth/status` SHALL emit no api-key row for `openrouter`
- **AND** the row SHALL reappear once a session pushes a catalogue
- **NOTE** while the runtime fallback is available, the `openrouter` api-key row SHALL be emitted from it instead

#### Scenario: Catalogue available
- **WHEN** a connected session has pushed a non-empty catalogue
- **THEN** the endpoint SHALL report `{ ready: true, fallback: false }`

#### Scenario: Request during runtime start-up
- **WHEN** the endpoint is requested before the server's model runtime has finished loading, and the runtime then loads successfully
- **THEN** the response SHALL be sent after loading completes and SHALL report `fallback: true`

#### Scenario: Last bridge disconnects
- **WHEN** a catalogue has been pushed and then the last bridge disconnects
- **THEN** the endpoint SHALL report `ready: false`
- **AND** SHALL report `fallback: true` when the runtime fallback is available

#### Scenario: Status response shape is unchanged
- **WHEN** a client requests `GET /api/provider-auth/status`
- **THEN** the body SHALL remain a bare JSON array with no added envelope
