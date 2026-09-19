# provider-auth-server Specification

## Purpose
Server-side contract for managing pi LLM provider credentials: OAuth handler registry, `auth.json` CRUD with atomic write+lockfile, the bridge-pushed provider catalogue cache, and the `GET /api/provider-auth/status` API surface that drives the Settings → Provider Authentication UI.

## Requirements

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

### Requirement: Auth-code OAuth flow — authorize
For auth-code providers (Anthropic, OpenAI Codex, Gemini CLI, Antigravity), the server SHALL generate a PKCE code verifier and challenge, build the provider's authorization URL with the dashboard's callback redirect URI, and return the auth URL along with a flow ID. The server SHALL store the PKCE verifier and state server-side, keyed by flow ID.

#### Scenario: Start Anthropic OAuth
- **WHEN** a client requests `POST /api/provider-auth/authorize` with `{ provider: "anthropic" }`
- **THEN** the server SHALL return `{ flowId, authUrl }` where `authUrl` points to `claude.ai/oauth/authorize` with PKCE challenge, redirect URI, and scopes `org:create_api_key user:profile user:inference`

#### Scenario: Start OpenAI Codex OAuth
- **WHEN** a client requests `POST /api/provider-auth/authorize` with `{ provider: "openai-codex" }`
- **THEN** the server SHALL return `{ flowId, authUrl }` where `authUrl` points to `auth.openai.com/oauth/authorize` with PKCE challenge and scope `openid profile email offline_access`

#### Scenario: Start Gemini CLI OAuth
- **WHEN** a client requests `POST /api/provider-auth/authorize` with `{ provider: "google-gemini-cli" }`
- **THEN** the server SHALL return `{ flowId, authUrl }` where `authUrl` points to Google OAuth with scopes including `cloud-platform`, `userinfo.email`, `userinfo.profile`, and `access_type=offline`

#### Scenario: Start Antigravity OAuth
- **WHEN** a client requests `POST /api/provider-auth/authorize` with `{ provider: "google-antigravity" }`
- **THEN** the server SHALL return `{ flowId, authUrl }` where `authUrl` points to Google OAuth with additional scopes `cclog` and `experimentsandconfigs`

### Requirement: Auth-code OAuth flow — exchange
The server SHALL accept an authorization code and flow ID, look up the stored PKCE verifier, exchange the code with the provider's token endpoint, perform any provider-specific post-exchange steps (e.g., project discovery for Google providers, accountId extraction for Codex), map the tokens to pi's `auth.json` format, and persist them.

#### Scenario: Exchange Anthropic code for tokens
- **WHEN** a client requests `POST /api/provider-auth/exchange` with `{ flowId, code }`
- **THEN** the server SHALL POST to `platform.claude.com/v1/oauth/token` with JSON body including `grant_type`, `client_id`, `code`, `redirect_uri`, `code_verifier`, and persist the resulting `{ type: "oauth", refresh, access, expires }` to `auth.json` under key `anthropic`

#### Scenario: Exchange Codex code with accountId extraction
- **WHEN** a client requests `POST /api/provider-auth/exchange` with `{ flowId, code }` for `openai-codex`
- **THEN** the server SHALL exchange the code, decode the JWT access token to extract `accountId` from the `https://api.openai.com/auth` claim, and persist `{ type: "oauth", refresh, access, expires, accountId }` under key `openai-codex`

#### Scenario: Exchange Gemini CLI code with project discovery
- **WHEN** a client requests `POST /api/provider-auth/exchange` with `{ flowId, code }` for `google-gemini-cli`
- **THEN** the server SHALL exchange the code using `client_id` and `client_secret`, call `loadCodeAssist` to discover/provision a Cloud project, and persist `{ type: "oauth", refresh, access, expires, projectId }` under key `google-gemini-cli`

#### Scenario: Exchange fails gracefully
- **WHEN** the provider's token endpoint returns an error
- **THEN** the server SHALL return HTTP 400 with `{ error: "..." }` describing the failure

#### Scenario: Unknown flow ID
- **WHEN** a client submits an exchange request with an invalid or expired `flowId`
- **THEN** the server SHALL return HTTP 400 with `{ error: "Invalid or expired flow" }`

### Requirement: Device-code OAuth flow
For device-code providers (GitHub Copilot), the server SHALL request a device code from the provider, return the verification URL and user code to the client, then poll the provider's token endpoint on a server-side interval until authorization completes or times out.

#### Scenario: Start GitHub Copilot device flow
- **WHEN** a client requests `POST /api/provider-auth/device-code` with `{ provider: "github-copilot" }` and optional `{ enterpriseDomain }`
- **THEN** the server SHALL request a device code from GitHub, return `{ flowId, userCode, verificationUri, expiresIn, interval }`, and begin polling in the background

#### Scenario: Poll completes successfully
- **WHEN** the user authorizes the device code on GitHub
- **THEN** the server SHALL obtain the GitHub access token, exchange it for a Copilot token via `copilot_internal/v2/token`, persist credentials to `auth.json` under key `github-copilot`, and make the result available when the client polls `GET /api/provider-auth/device-status/:flowId`

#### Scenario: Poll timeout
- **WHEN** the device code expires without authorization
- **THEN** the server SHALL stop polling and report `{ status: "expired" }` on the next client status check

### Requirement: OAuth callback route
The server SHALL serve a callback route at `GET /api/provider-auth/callback/:provider` that receives the OAuth redirect. This route SHALL return an HTML page that extracts `code` and `state` from the URL query parameters and relays them to the opener window via `window.opener.postMessage()`, `BroadcastChannel("provider_oauth_callback")`, and `localStorage` as fallbacks.

#### Scenario: Successful callback relay
- **WHEN** the OAuth provider redirects to `/api/provider-auth/callback/anthropic?code=abc&state=xyz`
- **THEN** the server SHALL respond with an HTML page that sends `{ type: "provider_oauth_callback", data: { code: "abc", state: "xyz" } }` via postMessage to the opener and closes itself

#### Scenario: Error callback
- **WHEN** the OAuth provider redirects with `?error=access_denied`
- **THEN** the callback page SHALL relay the error to the opener via the same channels

### Requirement: API key provider registry
The server SHALL derive the list of API-key providers from the bridge-pushed provider catalogue (`providers_list` message), NOT from a hardcoded array. The most recently received catalogue is cached per pi process; on cache miss the server SHALL proactively send `request_providers` and use an empty list until the bridge responds. For every entry in the cached catalogue:

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
- **WHEN** the server has not yet received any `providers_list` from any bridge
- **THEN** the API-key portion of the status response SHALL be an empty array, the OAuth portion SHALL still be returned, and the server SHALL have proactively sent `request_providers` to all connected bridges

#### Scenario: Extension-registered provider appears
- **WHEN** another pi extension calls `pi.registerProvider("custom-llm", ...)` and the bridge pushes a fresh `providers_list`
- **THEN** the server cache SHALL be updated and a `custom-llm` row (or `custom-llm-api` if the OAuth handler set grows) SHALL appear in the next `GET /api/provider-auth/status` response without any server restart

### Requirement: API key masking format
When displaying a saved API key in the status response, the server SHALL mask the key by showing the first 5 characters, followed by `...`, followed by the last 3 characters. For keys shorter than 12 characters, the server SHALL return `****` instead.

#### Scenario: Mask a standard-length key
- **WHEN** a provider has a saved key `sk-abc123xyz789`
- **THEN** `maskedKey` SHALL be `sk-ab...789`

#### Scenario: Mask a short key
- **WHEN** a provider has a saved key `shortkey` (8 chars, under 12)
- **THEN** `maskedKey` SHALL be `****`

#### Scenario: Mask an empty key
- **WHEN** a provider has a saved key that is an empty string
- **THEN** the provider SHALL have `authenticated: false` and no `maskedKey`

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

### Requirement: auth.json atomic write with locking
All writes to `auth.json` SHALL use a lockfile (`auth.json.lock`) with retry logic. If the file does not exist, it SHALL be created with `0600` permissions. Existing owner permission bits SHALL be preserved on update, with group/world bits always cleared (normalized to owner-only), so a legacy wider mode cannot persist. The staged `auth.json.tmp` SHALL have its mode explicitly enforced before the rename, because `writeFileSync`'s `mode` argument applies only at file creation. See change: fix-corrupt-auth-json-500.

The lock helper's own placeholder create — the empty `{}` file written so the lockfile has a target to lock — SHALL also use mode `0600`. Writing it without an explicit mode yields `0666 & ~umask` (typically `0644`), which `writeAuthJson`'s permission-preservation then carries forward to every subsequent write, leaving the credential file group- and world-readable.

Lock acquisition SHALL retry only the lock-already-held condition, for a bounded window of at most 2 seconds, and SHALL then fail. Any other lock or I/O failure (permissions, missing target, unreadable directory) SHALL propagate immediately without consuming the retry window. Waiting for the lock SHALL NOT block the server's event loop: while a write waits, the server SHALL continue to serve HTTP requests and WebSocket frames. See change: fix-provider-auth-lock-contention.

#### Scenario: Concurrent write protection
- **WHEN** two write operations occur simultaneously
- **THEN** one SHALL acquire the lock and complete; the other SHALL retry after a delay and then complete without data loss

#### Scenario: Held lock resolves within the bounded window
- **WHEN** a separate process holds the `auth.json` lock while a credential removal is waiting, and releases it early enough that a further retry attempt falls inside the bounded window
- **THEN** that attempt SHALL acquire the lock and the removal SHALL complete successfully, with the credential absent from `auth.json`
- **AND** no error SHALL be surfaced to the caller

#### Scenario: Waiting for the lock leaves the server responsive
- **WHEN** a credential write is waiting for a lock held by another process
- **THEN** the server SHALL answer `GET /api/health` while that wait is still in progress, at p95 under 200 ms
- **AND** the wait SHALL yield to the event loop between attempts rather than blocking it

#### Scenario: Bounded window is exhausted
- **WHEN** the `auth.json` lock stays held for longer than the bounded window during a credential write
- **THEN** the write SHALL fail without modifying `auth.json`

#### Scenario: Non-contention lock errors are not retried
- **WHEN** lock acquisition fails for a reason other than the lock being held — for example the lock directory is not writable
- **THEN** the operation SHALL fail immediately, without consuming the retry window

#### Scenario: New file creation
- **WHEN** `auth.json` does not exist and a credential is saved
- **THEN** the file SHALL be created with mode `0600` (owner read/write only)

#### Scenario: Lock placeholder create is 0600
- **WHEN** `auth.json` does not exist and any locked operation runs, causing the lock helper to pre-create the file
- **THEN** the pre-created file SHALL have mode `0600`
- **AND** the credential file written afterwards SHALL retain mode `0600`

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

### Requirement: auth.json corrupt-content recovery
Reading `auth.json` SHALL NOT fail because of its *content*. When the file's bytes are readable but do not parse as a JSON **plain object** — empty file, truncated JSON, `null`, an array, or a scalar — the server SHALL treat the credential set as empty (`{}`) and SHALL quarantine the bad bytes.

A leading UTF-8 BOM SHALL be stripped before parsing, so a BOM-prefixed but otherwise valid file is NOT classified as corrupt.

Quarantine SHALL copy the bad bytes to `auth.json.corrupt-<stamp>` in the same directory and SHALL NOT rename, move, truncate, or delete `auth.json`. `<stamp>` SHALL be `YYYYMMDDTHHMMSSsssZ` with no `:` character, so the name is valid on NTFS. The copy SHALL be created with the exclusive `wx` flag and mode `0600`; on `EEXIST` a numeric `-1`, `-2`, … suffix SHALL be appended so an existing backup is never overwritten.

The server SHALL log one line naming the quarantine path and the reason. The log line, the backup filename, and any HTTP error body SHALL NOT contain credential material.

Failures to *read the bytes at all* (`EACCES`, `EISDIR`, `EMFILE`, Windows `EPERM`/`EBUSY`) are NOT corrupt-content conditions and SHALL still throw. `ENOENT` SHALL keep its existing meaning: `{}`, no quarantine, no log.

#### Scenario: Empty auth.json yields an empty credential set
- **WHEN** `auth.json` exists and is zero bytes
- **THEN** the read SHALL return `{}` without throwing
- **AND** a copy of the file SHALL be written to `auth.json.corrupt-<stamp>` with mode `0600`
- **AND** `auth.json` SHALL still exist with its original bytes

#### Scenario: Truncated JSON is quarantined
- **WHEN** `auth.json` contains `{"anthropic": {"type": "oauth", "refr`
- **THEN** the read SHALL return `{}` without throwing
- **AND** the quarantine copy SHALL contain those exact bytes

#### Scenario: Valid JSON that is not a plain object is corrupt
- **WHEN** `auth.json` contains `null`, `[]`, or `42`
- **THEN** the read SHALL return `{}` without throwing and SHALL quarantine the bytes

#### Scenario: BOM-prefixed valid JSON is not corrupt
- **WHEN** `auth.json` contains a UTF-8 BOM followed by `{"openai":{"type":"api_key","key":"sk-x"}}`
- **THEN** the read SHALL return the `openai` credential
- **AND** no quarantine file SHALL be created

#### Scenario: Quarantine filename contains no colon
- **WHEN** any quarantine occurs
- **THEN** the created filename SHALL match `auth.json.corrupt-<stamp>` where `<stamp>` contains no `:` character

#### Scenario: Existing backup is never overwritten
- **WHEN** a quarantine target name already exists on disk
- **THEN** the server SHALL create `auth.json.corrupt-<stamp>-1` (then `-2`, …) instead of overwriting it

#### Scenario: Unreadable file still throws
- **WHEN** `readFileSync` on `auth.json` fails with `EACCES`
- **THEN** the read SHALL throw and SHALL NOT create a quarantine file

#### Scenario: Missing file is not a corruption
- **WHEN** `auth.json` does not exist
- **THEN** the read SHALL return `{}`, SHALL NOT create a quarantine file, and SHALL NOT log a quarantine line

#### Scenario: Quarantine is deduplicated by content
- **WHEN** the same corrupt bytes are read repeatedly within one process
- **THEN** exactly one quarantine copy SHALL be created for those bytes
- **AND** dedup identity SHALL be a hash of the bytes, not the file's size and mtime

#### Scenario: A failed quarantine copy is retried, not latched
- **WHEN** a quarantine copy fails and the same corrupt bytes are read again
- **THEN** the server SHALL attempt the copy again

#### Scenario: Read path swallows a quarantine failure
- **WHEN** the bytes are corrupt and the quarantine copy cannot be written
- **THEN** the read SHALL still return `{}` without throwing

### Requirement: Credential writes refuse to clobber un-backed-up bytes
A credential write (`writeCredential`, `removeCredential`) SHALL re-read `auth.json` while holding the lock, using a checked read that reports whether the content was corrupt and whether a recoverable copy exists on disk.

When the content is corrupt AND no recoverable copy exists, the write SHALL throw and SHALL persist nothing — the only path that can destroy the bytes is the only path allowed to fail. When the content is corrupt AND a recoverable copy exists, the write SHALL proceed against an empty credential set.

A quarantine **dedup hit** SHALL count as a recoverable copy existing: the flag means "a backup of these exact bytes is on disk", NOT "this call performed the copy". Otherwise the repair flow deadlocks — the mount-time read quarantines the bytes, and every later write, re-reading the still-corrupt file, would refuse forever.

#### Scenario: Write refuses when the backup could not be made
- **WHEN** `auth.json` is corrupt and the quarantine copy fails
- **AND** a client saves an API key
- **THEN** the write SHALL throw, `auth.json` SHALL be byte-identical to before, and no credential SHALL be persisted

#### Scenario: Write proceeds when the backup exists
- **WHEN** `auth.json` is corrupt and a quarantine copy was written successfully
- **AND** a client saves an API key for `openai`
- **THEN** `auth.json` SHALL be replaced with a file containing only the `openai` credential
- **AND** the pre-corruption bytes SHALL remain readable in the quarantine file

#### Scenario: Repair flow is not deadlocked by a dedup hit
- **GIVEN** a prior read already quarantined the corrupt bytes and recorded them as backed up
- **WHEN** a client saves an API key and the write re-reads the same still-corrupt `auth.json`
- **THEN** the write SHALL proceed (the dedup hit counts as backed up) and SHALL NOT throw

#### Scenario: Quarantine happens under the lock on the write path
- **WHEN** a write encounters corrupt content that no prior read had quarantined
- **THEN** the quarantine copy SHALL be attempted while the write lock is held, before any replacement of `auth.json`

### Requirement: Credential removal reports a refusal to the client
`DELETE /api/provider-auth/:provider` SHALL map any write failure — a refusal to clobber un-backed-up bytes, or an exhausted lock-contention window — to a JSON body carrying an `error` string describing the reason, matching the shape `PUT /api/provider-auth/api-key` already returns, so the Settings UI can display why the operation failed instead of a generic fallback. The response SHALL NOT fall through to the framework's generic `Internal Server Error` body, and the `error` string SHALL NOT contain credential material. See change: fix-provider-auth-lock-contention.

#### Scenario: Refused delete surfaces a reason
- **WHEN** a client sends `DELETE /api/provider-auth/anthropic` and the write refuses because the bytes could not be backed up
- **THEN** the response SHALL be `500` with a body including an `error` string naming the reason
- **AND** the body SHALL NOT contain credential material

#### Scenario: Lock-contention exhaustion surfaces a reason
- **WHEN** a client sends `DELETE /api/provider-auth/anthropic` and the lock stays held past the bounded window
- **THEN** the response SHALL be `500` with an `error` string identifying lock contention as the cause — the underlying lock error's own message SHALL be passed through rather than replaced by a generic phrase
- **AND** the body SHALL NOT be the framework's generic `Internal Server Error` message
- **AND** the body SHALL NOT contain credential material

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
