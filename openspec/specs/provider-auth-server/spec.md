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

#### Scenario: Mixed authenticated and unauthenticated providers
- **WHEN** `auth.json` contains credentials for `anthropic` and `openai` but not `github-copilot`
- **THEN** the status response SHALL show `authenticated: true` with `expires` for `anthropic`, `authenticated: true` for `openai` (API key, no expiry), and `authenticated: false` for `github-copilot`

#### Scenario: API-key row carries envVar hint
- **WHEN** the catalogue's `mistral` entry has `envVar: "MISTRAL_API_KEY"` and `auth.json` has no `mistral` entry
- **THEN** the `mistral` row in the status response SHALL include `envVar: "MISTRAL_API_KEY"` and `authenticated: false`

### Requirement: Credentials updated triggers per-session model refresh
When the server persists a credential change (`PUT /api/provider-auth/api-key`, `DELETE /api/provider-auth/:provider`, OAuth callback success, device-code completion, `PUT /api/providers`), it SHALL broadcast `credentials_updated` to every connected bridge so they reload `auth.json` + `~/.pi/agent/providers.json` and refresh their `ModelRegistry`. Each bridge SHALL then push a fresh per-session `models_list` (and `providers_list`) which the server forwards to browsers via the existing per-session broadcast.

The server SHALL NOT broadcast `models_refreshed` from any path. The previous design used a global broadcast that wiped every browser's `modelsMap` and re-requested only for the currently-selected session, which left previously-visited sessions in `subscribedRef` with empty dropdowns. The per-session `models_list` channel is self-healing without a wipe (see capability `model-refresh`).

The catalogue cache (`provider-catalogue-cache.ts`) is a pure read consumer for `GET /api/provider-auth/status`. Its update on `providers_list` arrival is idempotent and unobserved by browsers — the Settings UI re-fetches via the row-level `onChanged` callback after CRUD operations and via OAuth-flow polling during sign-in.

#### Scenario: Refresh after API-key write
- **WHEN** a client writes a new API key via `PUT /api/provider-auth/api-key`
- **THEN** the server SHALL persist the credential, broadcast `credentials_updated` to bridges, and return `{ ok: true }`
- **AND** each bridge SHALL push a fresh `models_list` for its own `sessionId` covering the new credential
- **AND** the server SHALL NOT broadcast `models_refreshed` to browsers

#### Scenario: Refresh after custom provider added
- **WHEN** a client writes a new custom provider via `PUT /api/providers`
- **THEN** the server SHALL persist the entry to `~/.pi/agent/providers.json`, broadcast `credentials_updated` to bridges, and return `{ success: true }`
- **AND** each bridge SHALL run `reloadProviders(pi)` (registering the new provider via `pi.registerProvider(...)` after async `discoverModels`)
- **AND** each bridge SHALL push fresh per-session `models_list` (and `providers_list`) reflecting the new provider's models
- **AND** the server SHALL NOT broadcast `models_refreshed` to browsers

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

#### Scenario: Save API key
- **WHEN** a client sends `PUT /api/provider-auth/api-key` with `{ provider: "openai", key: "sk-..." }`
- **THEN** the server SHALL write `{ "openai": { "type": "api_key", "key": "sk-..." } }` to `auth.json` (merging with existing entries) and return `{ ok: true }`

#### Scenario: Remove credential
- **WHEN** a client sends `DELETE /api/provider-auth/anthropic`
- **THEN** the server SHALL remove the `anthropic` key from `auth.json` and return `{ ok: true }`

### Requirement: auth.json atomic write with locking
All writes to `auth.json` SHALL use a lockfile (`auth.json.lock`) with retry logic. If the file does not exist, it SHALL be created with `0600` permissions. Existing file permissions SHALL be preserved on update.

#### Scenario: Concurrent write protection
- **WHEN** two write operations occur simultaneously
- **THEN** one SHALL acquire the lock and complete; the other SHALL retry after a delay and then complete without data loss

#### Scenario: New file creation
- **WHEN** `auth.json` does not exist and a credential is saved
- **THEN** the file SHALL be created with mode `0600` (owner read/write only)

### Requirement: Bridge notification on credential change
After any credential write (OAuth save, API key save, or credential removal), the server SHALL broadcast a `credentials_updated` message to all connected pi sessions via the pi WebSocket gateway.

#### Scenario: OAuth login triggers bridge notification
- **WHEN** a user completes OAuth login for Anthropic
- **THEN** the server SHALL send `{ type: "credentials_updated" }` to all connected bridge extensions via the pi gateway

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

