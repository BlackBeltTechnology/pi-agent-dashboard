# model-proxy Specification

## Purpose

OpenAI- and Anthropic-compatible HTTP proxy hosted by the dashboard server. Exposes `/v1/models`, `/v1/chat/completions`, and `/v1/messages` backed by the dashboard's effective model catalog (built-in providers, custom providers from `~/.pi/agent/providers.json`, custom models from `~/.pi/agent/models.json`, and OAuth state from `~/.pi/agent/auth.json`). Always-on lifetime tied to the dashboard process; authenticated uniformly via per-key proxy API keys (`pi-proxy-...`); coexists with upstream `@blackbelt-technology/pi-model-proxy`.

## Requirements

### Requirement: Always-on lifetime tied to dashboard

The model proxy SHALL be available whenever the dashboard server is running, independently of any pi session being active or connected.

#### Scenario: Proxy available with zero pi sessions

- **GIVEN** the dashboard server is running and `modelProxy.enabled === true`
- **AND** zero pi sessions are connected to the bridge gateway
- **WHEN** an external client GETs `/v1/models` with a valid bearer token
- **THEN** the response status is `200`
- **AND** the body conforms to OpenAI's `/v1/models` shape
- **AND** the `data` array contains the same models that `ModelRegistry.getAvailable()` returns

#### Scenario: Proxy survives pi session shutdown

- **GIVEN** a pi session is connected and the proxy has served at least one request
- **WHEN** every connected pi session disconnects
- **THEN** the proxy continues to accept requests
- **AND** the next `/v1/chat/completions` request to a credentialed model succeeds

#### Scenario: Proxy disabled by config

- **GIVEN** `modelProxy.enabled === false` in `~/.pi/dashboard/config.json`
- **WHEN** an external client GETs `/v1/models`
- **THEN** the response status is `404` (route not registered)

### Requirement: Model availability mirrors dashboard's effective catalog

`GET /v1/models` SHALL return exactly the models that `ModelRegistry.getAvailable()` exposes — i.e., models with configured authentication after composing built-in providers, `~/.pi/agent/providers.json` custom providers, `~/.pi/agent/models.json` custom models, and OAuth state from `~/.pi/agent/auth.json`.

#### Scenario: New OAuth login appears within one request

- **GIVEN** the proxy is running and the user has not logged into Anthropic
- **AND** `GET /v1/models` does not list any `anthropic/*` model
- **WHEN** the user completes the Anthropic OAuth flow via the dashboard's `/api/provider-auth/...` endpoint
- **THEN** the next `GET /v1/models` request lists at least one `anthropic/*` model
- **AND** no server restart is required

#### Scenario: Custom provider edit reflects immediately

- **GIVEN** the proxy is running
- **WHEN** the user `PUT`s a new custom provider via `/api/providers`
- **AND** the write succeeds
- **THEN** the next `GET /v1/models` request lists the new provider's models

#### Scenario: Models without credentials hidden

- **GIVEN** `~/.pi/agent/models.json` contains a model entry whose provider has no auth configured
- **WHEN** `GET /v1/models` is called
- **THEN** that model is NOT in the response
- **AND** `getAvailable()` semantics are preserved end-to-end

#### Scenario: Manual refresh endpoint

- **WHEN** the user POSTs `/api/model-proxy/refresh` with a valid JWT
- **THEN** the registry is force-refreshed
- **AND** the next `/v1/models` request reflects any on-disk changes the eager-trigger machinery missed

### Requirement: OpenAI Chat Completions compatibility

`POST /v1/chat/completions` SHALL accept OpenAI Chat Completions–shape requests and return OpenAI Chat Completions–shape responses. Streaming via `stream: true` returns Server-Sent Events with `data: <chunk>\n\n` framing terminated by `data: [DONE]\n\n`.

#### Scenario: Non-streaming request

- **WHEN** a client POSTs `/v1/chat/completions` with `{model, messages, stream: false}` and a valid bearer
- **THEN** the response has `Content-Type: application/json`
- **AND** the body has shape `{id, object: "chat.completion", model, choices: [{message: {role: "assistant", content}, finish_reason}], usage: {...}}`

#### Scenario: Streaming request

- **WHEN** a client POSTs `/v1/chat/completions` with `{model, messages, stream: true}`
- **THEN** the response has `Content-Type: text/event-stream`
- **AND** at least one chunk arrives with `choices[0].delta.content` non-empty
- **AND** the final framed event before `[DONE]` carries `finish_reason`

#### Scenario: Reasoning streaming

- **GIVEN** a model that emits thinking blocks (e.g. `google/gemini-2.5-flash` with reasoning enabled, or any Anthropic extended-thinking-capable model)
- **WHEN** a streaming request is issued
- **THEN** thinking content arrives in `delta.reasoning_content` chunks
- **AND** main text content arrives in `delta.content` chunks separately

#### Scenario: Tool calls

- **WHEN** a request includes `tools: [{type: "function", function: {name, parameters}}]`
- **AND** the model decides to call a tool
- **THEN** the response chunk includes `delta.tool_calls[].function.{name, arguments}` with correct multi-tool indices

#### Scenario: System messages

- **WHEN** the request `messages[0].role === "system"`
- **THEN** the system content is forwarded to the upstream provider in the provider's native system-message slot (Anthropic's `system` field, OpenAI's `messages[0]`, Google's `systemInstruction`, etc.)

#### Scenario: Multi-modal images

- **WHEN** a `messages[].content` array includes `{type: "image_url", image_url: {url: "data:image/...;base64,..."}}`
- **AND** the chosen model declares `input: ["text", "image"]` in its catalog
- **THEN** the image is forwarded to the upstream provider in the provider's native image format

### Requirement: Anthropic Messages compatibility

`POST /v1/messages` SHALL accept Anthropic Messages–shape requests and return Anthropic Messages–shape responses. Streaming returns native Anthropic SSE event frames (`event: message_start`, `event: content_block_delta`, etc.).

#### Scenario: Non-streaming request

- **WHEN** a client POSTs `/v1/messages` with `{model, messages, max_tokens, stream: false}`
- **THEN** the response body has shape `{id, type: "message", role: "assistant", content: [{type: "text", text}], model, stop_reason, usage: {...}}`

#### Scenario: Streaming with thinking_delta

- **GIVEN** a thinking-capable model
- **WHEN** a streaming `/v1/messages` request fires
- **THEN** `event: content_block_delta` frames include both `thinking_delta` (for reasoning) and `text_delta` (for output) discriminated by their `delta.type`

#### Scenario: max_tokens enforcement

- **WHEN** `max_tokens: 100` is requested
- **THEN** the upstream call is configured with that cap
- **AND** the response respects the cap

### Requirement: Authentication via proxy API key (uniform)

`/v1/*` routes SHALL require a valid proxy API key on every request, regardless of source. The dashboard's existing bypass rules (loopback, `bypassHosts`, `bypassUrls`) SHALL NOT apply to `/v1/*` paths. Dashboard JWT SHALL NOT authenticate `/v1/*` requests. Each key SHALL carry a scope set; access SHALL be granted only when the requested route falls within the key's scopes. Expired and revoked keys SHALL be rejected with `401`. Failed authentications SHALL be subject to per-source-IP exponential backoff.

#### Scenario: Valid proxy API key on loopback

- **GIVEN** an API key created via `POST /api/model-proxy/api-keys` with `scopes: ["all"]`
- **WHEN** the client sends `Authorization: Bearer pi-proxy-<key>` from `127.0.0.1`
- **THEN** the request is authenticated
- **AND** the API key's `lastUsedAt` is updated (debounced to once per 60s per key)

#### Scenario: Valid proxy API key on LAN

- **GIVEN** the dashboard has `bypassHosts` configured to trust LAN IPs
- **WHEN** a request from a trusted LAN IP arrives with `Authorization: Bearer pi-proxy-<key>`
- **THEN** the request is authenticated
- **AND** the bypass would NOT have authenticated the request without the key

#### Scenario: Valid proxy API key on tunnel

- **GIVEN** the dashboard's zrok tunnel is active
- **WHEN** a request arrives at the tunnel hostname with `Authorization: Bearer pi-proxy-<key>`
- **THEN** the request is authenticated

#### Scenario: JWT rejected (uniform)

- **WHEN** any `/v1/*` request arrives carrying `Authorization: Bearer <jwt>` (a dashboard JWT, not a proxy key)
- **THEN** the response is `401` with body `{code: "PROXY_KEY_REQUIRED", message: ...}`
- **AND** this is the case regardless of whether the source is loopback, LAN-trusted, or tunnel

#### Scenario: Loopback without API key rejected

- **GIVEN** the dashboard is configured with no auth at all (no `auth.providers`, no `auth.secret`)
- **WHEN** a `/v1/models` request arrives from `127.0.0.1` with no `Authorization` header
- **THEN** the response is `401` with body `{code: "AUTH_REQUIRED", message: ...}`
- **AND** other dashboard endpoints (`/api/health`, the UI) continue to behave per their existing bypass rules

#### Scenario: Scope insufficient for endpoint

- **GIVEN** an API key with `scopes: ["models:list"]`
- **WHEN** the client uses it to POST `/v1/chat/completions`
- **THEN** the response is `403` with body `{code: "SCOPE_INSUFFICIENT", required: "chat", granted: ["models:list"]}`

#### Scenario: Scope sufficient for endpoint

- **GIVEN** an API key with `scopes: ["all"]`
- **WHEN** the client uses it for any of `/v1/models`, `/v1/chat/completions`, `/v1/messages`
- **THEN** the request is authenticated AND the scope check passes

#### Scenario: Expired API key

- **GIVEN** an API key with `expiresAt` set to a past timestamp
- **WHEN** a client uses it
- **THEN** the response is `401` with body `{code: "AUTH_EXPIRED", message: ...}`
- **AND** the entry remains on disk (NOT auto-pruned)

#### Scenario: Revoked API key

- **GIVEN** an API key was revoked via `DELETE /api/model-proxy/api-keys/:id`
- **AND** the entry has `revokedAt` set (soft-delete)
- **WHEN** a client uses the revoked key
- **THEN** the response is `401` with body `{code: "AUTH_REVOKED", message: ...}`
- **AND** the entry is still listed in the UI's "Revoked keys" section so request-log entries remain attributable

#### Scenario: Missing authorization

- **WHEN** the client sends no `Authorization` header
- **THEN** the response is `401` with body `{code: "AUTH_REQUIRED", message: ...}`

#### Scenario: Malformed bearer

- **WHEN** `Authorization` is present but does not start with `Bearer `
- **OR** the token is empty
- **OR** the token starts with `Bearer ` but is not a `pi-proxy-` key
- **THEN** the response is `401` with body `{code: "AUTH_MALFORMED", message: ...}`

#### Scenario: Failed-auth backoff per source IP

- **GIVEN** five consecutive failed auth attempts from the same source IP within 60s
- **WHEN** a sixth request arrives from that IP
- **THEN** the response is delayed by an exponentially-increasing window (10ms → 20ms → 40ms → … capped at 10s)
- **AND** the backoff counter resets on the first successful auth from that IP
- **AND** the backoff state is in-memory (does not survive dashboard restart)

#### Scenario: Per-user key visibility (multi-user dashboard)

- **GIVEN** the dashboard has `auth.allowedUsers: ["alice@x", "bob@x"]`
- **AND** alice creates an API key labeled "alice-ci"
- **WHEN** bob lists `/api/model-proxy/api-keys`
- **THEN** the response does NOT include alice's key

#### Scenario: Admin override (multi-user dashboard)

- **GIVEN** the dashboard has `auth.allowedUsers` configured AND `auth.admin: "alice@x"`
- **WHEN** alice (admin) lists `/api/model-proxy/api-keys`
- **THEN** the response includes every user's keys
- **AND** alice can revoke any user's key

#### Scenario: Dashboard UI calls /v1/* using its own cached key

- **GIVEN** the user has minted an API key during settings setup AND the cleartext was cached in browser `sessionStorage`
- **WHEN** the settings panel's "Test" button calls `/v1/models`
- **THEN** the request includes `Authorization: Bearer pi-proxy-<key>` from `sessionStorage`
- **AND** the request is authenticated like any other client
- **AND** the cleartext key is NEVER persisted to `localStorage` or written to disk by the UI

### Requirement: API key management surface

The dashboard SHALL expose REST endpoints for creating, listing, and deleting proxy API keys. Keys SHALL be revealed exactly once at creation and stored on disk only as a `sha256` hash. The management endpoints themselves require a JWT (not an API key).

#### Scenario: Create key

- **WHEN** the user POSTs `/api/model-proxy/api-keys` with `{label: "ci"}` and a valid JWT
- **THEN** the response is `201` with body `{id, label, createdAt, key: "pi-proxy-<48 chars>"}`
- **AND** the `key` field is the cleartext key, returned ONCE
- **AND** `~/.pi/dashboard/config.json#modelProxy.apiKeys` gains a new entry with `hash` set and `key` absent

#### Scenario: List keys redacts hash

- **WHEN** the user GETs `/api/model-proxy/api-keys` with a valid JWT
- **THEN** each entry has `hash: "***"` (redacted)
- **AND** entries include `id`, `label`, `createdAt`, `lastUsedAt?`

#### Scenario: Delete key

- **WHEN** the user DELETEs `/api/model-proxy/api-keys/:id` with a valid JWT
- **THEN** the response is `204`
- **AND** subsequent uses of that key are rejected with `401`

#### Scenario: Delete unknown key

- **WHEN** DELETE targets an `id` not in the store
- **THEN** the response is `404`

#### Scenario: Cleartext keys never persisted

- **WHEN** any operation involves an API key
- **THEN** `~/.pi/dashboard/config.json` MUST NOT contain the cleartext key value at any point

### Requirement: Streaming abort propagates upstream

When a client closes the connection during a streaming response, the proxy SHALL cancel the upstream provider call within a bounded time and stop charging for further tokens.

#### Scenario: Client disconnect during stream

- **GIVEN** an active `/v1/chat/completions` stream
- **WHEN** the client closes the TCP connection
- **THEN** within 200ms the upstream provider call's `AbortSignal` is fired
- **AND** the upstream HTTP request to the provider is closed

#### Scenario: Client closes after final chunk

- **WHEN** the client closes the connection AFTER the proxy has written `[DONE]`
- **THEN** no abort is needed
- **AND** no error is logged

### Requirement: Concurrency caps

The proxy SHALL enforce three nested concurrency caps. Server-wide cap SHALL default to 16 concurrent streams, per-API-key cap SHALL default to 4, per-upstream-provider cap SHALL default to 4.

#### Scenario: Server cap exhausted

- **GIVEN** 16 streams are already active (server-wide cap reached)
- **WHEN** a 17th request arrives
- **THEN** the response is `503` with body `{code: "SERVER_FULL"}` and a `Retry-After` header

#### Scenario: Per-API-key cap exhausted

- **GIVEN** API key `K` has 4 active streams
- **AND** server-wide cap is not exhausted
- **WHEN** a 5th request from key `K` arrives
- **THEN** the response is `429` with body `{code: "KEY_FULL"}` and a `Retry-After` header

#### Scenario: Per-provider cap exhausted

- **GIVEN** 4 streams against `anthropic/*` are active
- **AND** other caps are not exhausted
- **WHEN** a 5th request to any `anthropic/*` model arrives
- **THEN** the response is `429` with body `{code: "PROVIDER_FULL"}` and a `Retry-After` header

#### Scenario: Cap release on stream completion

- **WHEN** any stream completes (success, error, or abort)
- **THEN** all three counters (server, per-key, per-provider) are decremented exactly once

#### Scenario: Live cap update

- **WHEN** the user updates `modelProxy.maxConcurrentStreams` via `POST /api/config` while requests are in flight
- **THEN** in-flight requests are unaffected
- **AND** the new cap applies to subsequent requests

### Requirement: Recursion guard

The dashboard SHALL refuse to register a custom provider whose `baseUrl` resolves to the dashboard's own listen origin.

#### Scenario: Self-pointing localhost rejected

- **GIVEN** the dashboard listens on `:8000`
- **WHEN** the user PUTs `/api/providers` with an entry `{baseUrl: "http://localhost:8000/v1"}`
- **THEN** the response is `400` with body `{code: "RECURSIVE_PROXY", offendingBaseUrl: "..."}`
- **AND** no providers are written

#### Scenario: Self-pointing 127.0.0.1 rejected

- **WHEN** `baseUrl: "http://127.0.0.1:8000/v1"` is submitted
- **THEN** the response is `400` with `code: "RECURSIVE_PROXY"`

#### Scenario: Self-pointing LAN address rejected

- **GIVEN** the dashboard is bound to `0.0.0.0:8000` and the host has LAN IP `192.168.1.10`
- **WHEN** `baseUrl: "http://192.168.1.10:8000/v1"` is submitted
- **THEN** the response is `400` with `code: "RECURSIVE_PROXY"`

#### Scenario: Self-pointing tunnel hostname rejected

- **GIVEN** the active zrok tunnel hostname is `abcdef.share.zrok.io`
- **WHEN** `baseUrl: "https://abcdef.share.zrok.io/v1"` is submitted
- **THEN** the response is `400` with `code: "RECURSIVE_PROXY"`

#### Scenario: Legitimate external URL passes

- **WHEN** `baseUrl: "https://api.openai.com/v1"` or any other non-self URL is submitted
- **THEN** the request is accepted and providers are written normally

#### Scenario: Off-machine self-reference not detected

- **GIVEN** the dashboard runs at `10.0.0.5:8000`
- **AND** the user enters `baseUrl: "http://10.0.0.5:8000/v1"` from a DIFFERENT machine where `10.0.0.5` is the dashboard host
- **THEN** the guard MAY pass (off-machine perspective unknown)
- **AND** the resulting recursion manifests as upstream timeout on first use, not infinite recursion (timeouts contain the failure)

### Requirement: Optional second listener port

When `modelProxy.secondPort` is set in config, the proxy SHALL also listen on that port and serve identical `/v1/*` routes.

#### Scenario: Second port active

- **GIVEN** `modelProxy.secondPort: 9876`
- **WHEN** the dashboard server starts
- **THEN** both `:8000/v1/models` and `:9876/v1/models` return identical response bodies for the same authenticated request

#### Scenario: Second port bind failure non-fatal

- **GIVEN** `modelProxy.secondPort: 9876` but port 9876 is already taken
- **WHEN** the dashboard server starts
- **THEN** the main server still binds and operates normally on `:8000`
- **AND** a warning is logged citing `EADDRINUSE` and the configured second port
- **AND** `:9876` is not used

#### Scenario: Second port unconfigured

- **GIVEN** `modelProxy.secondPort` is unset or `null`
- **WHEN** the dashboard server starts
- **THEN** only the primary port serves `/v1/*`

### Requirement: Optional request log

When `modelProxy.logRequests === true`, the proxy SHALL append one JSONL entry per completed request to `~/.pi/dashboard/model-proxy.jsonl`. Entries SHALL never contain request body, response body, or API keys.

#### Scenario: Log enabled

- **GIVEN** `logRequests: true`
- **WHEN** a request completes
- **THEN** a single line is appended with shape `{ts, requestId, apiKeyId?, model, format, status, durationMs, inputTokens?, outputTokens?, error?}`

#### Scenario: Log disabled

- **GIVEN** `logRequests: false`
- **WHEN** a request completes
- **THEN** no log file is created or written

#### Scenario: API key never logged

- **WHEN** a logged request was authenticated with API key `pi-proxy-<key>`
- **THEN** no log line contains the cleartext key
- **AND** at most the key's `id` is recorded as `apiKeyId`

#### Scenario: Log rotation

- **GIVEN** the log file size exceeds 50MB
- **WHEN** the next entry is about to be written
- **THEN** the existing file is renamed to `model-proxy.jsonl.<ISO-date>` and a fresh file is started

### Requirement: Coexistence with upstream pi-model-proxy

The dashboard's model proxy SHALL coexist with the upstream `@blackbelt-technology/pi-model-proxy` extension running inside any pi session, with no enforced mutual exclusion.

#### Scenario: Both active simultaneously

- **GIVEN** the dashboard proxy is enabled on `:8000/v1`
- **AND** at least one connected pi session has the upstream extension loaded on `:9876`
- **WHEN** an external client uses either endpoint
- **THEN** that endpoint serves the request normally
- **AND** neither endpoint interferes with the other

#### Scenario: Coexistence advisory in UI

- **GIVEN** the dashboard detects `npm:@blackbelt-technology/pi-model-proxy` in `~/.pi/agent/settings.json#packages`
- **WHEN** the user opens the Model Proxy section in settings
- **THEN** a non-blocking advisory banner is rendered explaining both are active and linking to the disable instructions
- **AND** the advisory does NOT prevent the dashboard proxy from operating

### Requirement: Tunnel passthrough

When the dashboard's zrok tunnel is active, `/v1/*` SHALL be reachable via the tunnel hostname using the same auth rules with the tunnel-API-key restriction enforced.

#### Scenario: Tunnel active, valid API key

- **GIVEN** the tunnel is active at `https://abcdef.share.zrok.io`
- **WHEN** an external client GETs `https://abcdef.share.zrok.io/v1/models` with `Authorization: Bearer pi-proxy-<key>`
- **THEN** the response is `200` with the same body it would return on loopback

#### Scenario: Tunnel active, JWT rejected

- **GIVEN** the tunnel is active
- **WHEN** an external client GETs the tunnel URL with `Authorization: Bearer <jwt>`
- **THEN** the response is `401` with `code: "PROXY_KEY_REQUIRED"` (uniform rejection per design.md Decision 2 — no source-specific error codes)

### Requirement: Settings UI persists model proxy configuration

The dashboard Settings panel SHALL persist changes to `modelProxy` configuration (enabled, defaultModel, secondPort, maxConcurrentStreams, perKeyConcurrentStreams, logRequests) to `~/.pi/dashboard/config.json` via `PUT /api/config` when the user clicks Save. The persistence SHALL follow the same diff-and-merge pattern used by other config sections (tunnel, memoryLimits, openspec, editor, auth).

#### Scenario: Model proxy enabled toggle persisted

- **GIVEN** the Settings panel is open on the Providers tab
- **AND** `modelProxy.enabled` is currently `true`
- **WHEN** the user toggles the API Proxy switch to off and clicks Save
- **THEN** the `PUT /api/config` request body SHALL include `modelProxy: { enabled: false, ... }`
- **AND** `~/.pi/dashboard/config.json` SHALL be updated with `modelProxy.enabled: false`
- **AND** subsequent page reloads SHALL reflect the disabled state

#### Scenario: Model proxy default model persisted

- **GIVEN** the model proxy is enabled
- **WHEN** the user types `anthropic/claude-3-5-sonnet` into the Default Model field and clicks Save
- **THEN** the `PUT /api/config` request body SHALL include `modelProxy` with `defaultModel: "anthropic/claude-3-5-sonnet"`
- **AND** subsequent `/v1/chat/completions` requests that omit `model` SHALL use `anthropic/claude-3-5-sonnet`

#### Scenario: Model proxy second port persisted

- **GIVEN** the model proxy is enabled
- **WHEN** the user enters `9876` in the Second Port field, moves focus away (blur), and clicks Save
- **THEN** the `PUT /api/config` request body SHALL include `modelProxy` with `secondPort: 9876`
- **AND** after a server restart, the proxy SHALL listen on port 9876 in addition to the primary port

#### Scenario: Model proxy sub-object merged atomically

- **GIVEN** `modelProxy` has existing config on disk (`enabled: true, secondPort: 9876`)
- **WHEN** the user changes only `defaultModel` and clicks Save
- **THEN** the saved config SHALL retain `enabled: true` and `secondPort: 9876`
- **AND** the saved config SHALL include the new `defaultModel`
- **AND** no other `modelProxy` fields are lost

#### Scenario: Model proxy changes trigger "No changes to save" correctly

- **GIVEN** the user has made no changes to any field including model proxy
- **WHEN** the user clicks Save
- **THEN** the UI SHALL display "No changes to save"
- **AND** no `PUT /api/config` request is sent

#### Scenario: Model proxy changes included alongside other config changes

- **GIVEN** the user changes `defaultModel` in both the General tab and the API Proxy section
- **WHEN** the user clicks Save
- **THEN** a single `PUT /api/config` request SHALL be sent
- **AND** the request body SHALL include both `defaultModel` (top-level string) and `modelProxy` (sub-object)

