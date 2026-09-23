## MODIFIED Requirements

### Requirement: OAuth provider registry

The server SHALL derive its registry of OAuth providers from the provider definitions of the pi runtime it depends on — every built-in provider that advertises an OAuth login — not from a hand-maintained set of per-provider flow implementations. Each registry entry SHALL expose the provider id, a display name taken from the provider's own OAuth login name, and a `flowType` of `auth_code` or `device_code`. `flowType` is a UI hint (which pane opens first) drawn from a small static table (`anthropic`, `openai-codex`, `openrouter` → `auth_code`; any other id → `device_code`); it SHALL NOT gate which flows a provider may run. `GET /api/provider-auth/providers` SHALL be derived directly from this registry. The registry SHALL exclude `radius` (a per-gateway factory instantiated from pi settings the dashboard does not manage). On pi 0.86.1 the registry SHALL contain exactly: `anthropic`, `openai-codex`, `github-copilot`, `openrouter`, `kimi-coding`, `meta`, `xai`.

#### Scenario: List available OAuth providers
- **WHEN** a client requests `GET /api/provider-auth/providers`
- **THEN** the server SHALL return a JSON array of `{ id, name, flowType }` for every registry entry, with `name` taken from the provider's OAuth login name

#### Scenario: Adding a new OAuth handler is the only required change
- **WHEN** the pi runtime the server resolves adds a built-in provider with an OAuth login
- **THEN** that id SHALL appear in `GET /api/provider-auth/providers` after a server restart with no change to dashboard source, with `flowType: "device_code"` unless the static hint table names it
- **AND** no separately maintained provider list exists to update

#### Scenario: radius is excluded
- **WHEN** the resolved pi runtime defines a `radius` provider with an OAuth login
- **THEN** `radius` SHALL NOT appear in `GET /api/provider-auth/providers` or `GET /api/provider-auth/handlers`
- **AND** `POST /api/provider-auth/start` with `{ provider: "radius" }` SHALL return 400

#### Scenario: Removed pi providers do not appear
- **WHEN** the catalogue (`providers_list` from the bridge) reports the union of pi's known providers on pi 0.71+
- **THEN** `google-gemini-cli` and `google-antigravity` SHALL NOT appear in either the catalogue or the handler-id list

### Requirement: Server exposes registered handler ids

The server SHALL expose `GET /api/provider-auth/handlers` returning `{ ids: string[] }` — the list of provider ids the dashboard can drive a login flow for, equal to the OAuth provider registry's id set. Distinct from the catalogue (the union of pi's providers): a catalogue id absent from `ids` is an OAuth provider the UI knows about but the dashboard cannot complete a login for. This endpoint imposes no rendering obligation on the UI.

#### Scenario: Default handler ids
- **WHEN** the server starts against pi 0.86.1
- **THEN** `GET /api/provider-auth/handlers` returns `{ ids }` containing exactly `anthropic`, `openai-codex`, `github-copilot`, `openrouter`, `kimi-coding`, `meta`, `xai` in any order

#### Scenario: Catalogue lists provider not in handlers
- **WHEN** the bridge has pushed a catalogue containing `{ id: "custom-llm", hasOAuth: true }` (e.g. from `pi.registerProvider({ oauth: ... })`)
- **AND** `GET /api/provider-auth/handlers` returns ids without `custom-llm`
- **THEN** `GET /api/provider-auth/status` SHALL NOT emit `custom-llm` as an OAuth row, because OAuth rows are built from the registry only
- **AND** `POST /api/provider-auth/start` for `custom-llm` SHALL return 400 with `error: "Unknown OAuth provider: custom-llm"`

## ADDED Requirements

### Requirement: Flow start

The server SHALL expose `POST /api/provider-auth/start` with body `{ provider, enterpriseDomain? }` that starts the pi runtime's OAuth login for that provider and answers once the flow has produced its first user-facing step. PKCE, state, authorization URLs, the localhost callback listener, device-code polling, and the code-for-token exchange are owned by the runtime's flow; the server SHALL NOT construct any of them. The response SHALL be the flow's status (see "Flow status") including `flowId`. When the flow publishes an authorization URL the server SHALL open it in the local browser where one is available. When `enterpriseDomain` is supplied it SHALL be used to answer the flow's first free-text prompt without that prompt ever being reported as pending.

#### Scenario: Start Anthropic
- **WHEN** a client requests `POST /api/provider-auth/start` with `{ provider: "anthropic" }`
- **THEN** the server SHALL return HTTP 200 with `flowId`, `authUrl`, and `pending: { kind: "manual_code", ... }` in the same response

#### Scenario: Start OpenAI Codex
- **WHEN** a client requests `POST /api/provider-auth/start` with `{ provider: "openai-codex" }`
- **THEN** the server SHALL return HTTP 200 with `flowId` and `pending: { kind: "select", options }` naming the browser and device-code login methods, and no `authUrl` yet

#### Scenario: Start GitHub Copilot with an enterprise domain
- **WHEN** a client requests `POST /api/provider-auth/start` with `{ provider: "github-copilot", enterpriseDomain: "" }`
- **THEN** the server SHALL return HTTP 200 with `flowId` and `pending: { kind: "device_code", userCode, verificationUri, intervalSeconds, expiresInSeconds }`
- **AND** no `text` prompt SHALL have been reported as pending

#### Scenario: Start GitHub Copilot without an enterprise domain
- **WHEN** a client requests `POST /api/provider-auth/start` with `{ provider: "github-copilot" }` and no `enterpriseDomain`
- **THEN** the server SHALL return HTTP 200 with `pending: { kind: "text", message, placeholder }` for the enterprise-domain question

#### Scenario: Start a device-code provider
- **WHEN** a client requests `POST /api/provider-auth/start` with `{ provider }` for any of `kimi-coding`, `meta`, `xai`
- **THEN** the server SHALL return HTTP 200 with `pending: { kind: "device_code", ... }` with no provider-specific dashboard code involved

#### Scenario: Start OpenRouter
- **WHEN** a client requests `POST /api/provider-auth/start` with `{ provider: "openrouter" }`
- **THEN** the server SHALL return HTTP 200 with `authUrl` and `pending.kind: "manual_code"`
- **AND** on completion the persisted credential SHALL be whatever the runtime's OpenRouter flow returned, written under key `openrouter`

#### Scenario: Second start for the same provider supersedes the first
- **WHEN** a client starts a flow for `anthropic` while an earlier `anthropic` flow is still pending
- **THEN** the earlier flow SHALL be cancelled (its listener closed) before the new one starts, the new start SHALL return HTTP 200, and the earlier flow SHALL report `status: "error", error: "Cancelled"`

#### Scenario: Callback port already bound
- **WHEN** the flow's localhost callback port is already in use by something the server does not own (for example a pi session running `/login` on the same host)
- **THEN** `POST /api/provider-auth/start` SHALL return HTTP 500 with `{ error }` naming the port, and no flow SHALL remain pending

#### Scenario: Provider does not respond
- **WHEN** the flow produces neither a user-facing step nor a failure within 15 seconds of start
- **THEN** the server SHALL abort the flow and return HTTP 504 with `{ error: "Provider did not respond" }`

#### Scenario: Unknown or excluded provider
- **WHEN** a client requests `POST /api/provider-auth/start` with a provider id not in the registry (including `radius`, `google-gemini-cli`, `google-antigravity`, and api-key-only ids)
- **THEN** the server SHALL return HTTP 400 with `{ error: "Unknown OAuth provider: <id>" }`

### Requirement: Flow status

The server SHALL expose `GET /api/provider-auth/flow/:flowId` for every flow started by `start`. The response SHALL contain `flowId`, `provider`, `status` (`"pending" | "complete" | "error" | "expired"`), `authUrl` when the flow has published one (retained for the life of the flow), `message` (the most recent progress text from the flow, if any), `error` when `status` is `"error"`, and `pending` describing what the client must render or answer next:

- `{ kind: "device_code", userCode, verificationUri, intervalSeconds?, expiresInSeconds? }`
- `{ kind: "manual_code", message, placeholder? }`
- `{ kind: "text", message, placeholder? }`
- `{ kind: "select", message, options: { id, label, description? }[] }`

`pending` SHALL be absent when the flow is waiting on the provider (callback / poll) with nothing for the user to answer, and when `status` is not `"pending"`. The response SHALL NEVER include any value the user submitted. Flow ids SHALL be unguessable (UUID v4).

#### Scenario: Auth-code flow reports link and paste prompt together
- **WHEN** an Anthropic flow has published its authorization URL and asked for a pasted code
- **THEN** `GET /api/provider-auth/flow/:flowId` SHALL return `status: "pending"`, `authUrl`, and `pending: { kind: "manual_code", ... }` in the same response

#### Scenario: Codex select answered with browser
- **WHEN** a Codex flow's `select` prompt has been answered with the browser method
- **THEN** a subsequent `GET /api/provider-auth/flow/:flowId` SHALL report `authUrl` and `pending.kind: "manual_code"`

#### Scenario: Completion
- **WHEN** the runtime's flow resolves with a credential
- **THEN** the server SHALL persist it to `auth.json` under the provider id via the existing locked, backed-up write path, notify bridges, and `GET /api/provider-auth/flow/:flowId` SHALL report `status: "complete"` with no `pending`

#### Scenario: Device code expires
- **WHEN** a device code's `expiresInSeconds` elapses without authorization and the runtime's flow gives up
- **THEN** `GET /api/provider-auth/flow/:flowId` SHALL report `status: "expired"` (derived from the elapsed deadline, not from the runtime's error text) until the flow is pruned

#### Scenario: Credential write refused after a successful exchange
- **WHEN** the runtime's flow resolves with an OAuth credential for a provider whose `auth.json` entry is an api-key credential
- **THEN** the flow SHALL report `status: "error"` with the write path's conflict message, and `auth.json` SHALL be unchanged

#### Scenario: Unknown flow id
- **WHEN** a client requests `GET /api/provider-auth/flow/:flowId` with an id that was never issued or was pruned
- **THEN** the server SHALL return HTTP 404 with `{ error: "Invalid or expired flow" }`

#### Scenario: Flow failure surfaces the flow's own message
- **WHEN** the runtime's flow rejects (provider error, state mismatch, denied consent)
- **THEN** `GET /api/provider-auth/flow/:flowId` SHALL report `status: "error"` and `error` equal to the flow's error message

### Requirement: Flow input

The server SHALL expose `POST /api/provider-auth/flow/:flowId/input` with body `{ value: string }` that answers the flow's currently pending prompt. For `manual_code` the value is a pasted authorization code or full redirect URL; for `text` it is the free-text answer; for `select` it is an option `id`. The submitted value SHALL be handed to the runtime's flow unchanged and SHALL NOT be logged, persisted, or echoed in any response. Validation of the value (state check, option membership, domain format) is owned by the flow; its rejection surfaces as `status: "error"` on the next status read.

#### Scenario: Pasted redirect URL completes a remote sign-in
- **WHEN** a client whose browser cannot reach the server's localhost callback submits the full redirect URL to `POST /api/provider-auth/flow/:flowId/input`
- **THEN** the server SHALL return HTTP 202 `{ ok: true }`
- **AND** the flow SHALL exchange the code, the credential SHALL be persisted under the provider id, and the flow SHALL report `status: "complete"`

#### Scenario: Select answered
- **WHEN** a client submits `{ value: "<option id>" }` while `pending.kind` is `"select"`
- **THEN** the server SHALL return HTTP 202 and the flow SHALL advance to the chosen method's next prompt or event

#### Scenario: Text answered
- **WHEN** a client submits `{ value: "company.ghe.com" }` while `pending.kind` is `"text"` on a GitHub Copilot flow
- **THEN** the server SHALL return HTTP 202 and the next status read SHALL report `pending.kind: "device_code"` with a `verificationUri` on that domain

#### Scenario: No prompt pending
- **WHEN** a client submits input while the flow has no answerable prompt — no `pending`, or `pending.kind` is `"device_code"`
- **THEN** the server SHALL return HTTP 409 with `{ error: "No input pending for this flow" }`

#### Scenario: State mismatch is the flow's verdict
- **WHEN** a pasted redirect URL carries a `state` that does not match the flow's
- **THEN** the input endpoint SHALL still return HTTP 202, and the next `GET /api/provider-auth/flow/:flowId` SHALL report `status: "error"` with the flow's mismatch message

### Requirement: Flow cancel

The server SHALL expose `DELETE /api/provider-auth/flow/:flowId`, which aborts the runtime's flow — rejecting any pending prompt, closing any callback listener, and stopping any poll — and marks the flow `status: "error"` with `error: "Cancelled"`. Server shutdown SHALL abort every pending flow the same way.

#### Scenario: Cancel mid-poll reports Cancelled
- **WHEN** a client cancels a device-code flow that is polling with no prompt pending
- **THEN** the flow SHALL report `status: "error", error: "Cancelled"` — not the runtime's own cancellation message

#### Scenario: Cancel releases the callback port
- **WHEN** a client cancels a pending Anthropic flow whose paste prompt is outstanding
- **THEN** the server SHALL return HTTP 204, the flow SHALL report `status: "error", error: "Cancelled"` within 1 second, and a subsequent `POST /api/provider-auth/start` for `anthropic` SHALL succeed without a port-in-use error

#### Scenario: Cancel unknown flow
- **WHEN** a client cancels a flow id that was never issued or was pruned
- **THEN** the server SHALL return HTTP 404

### Requirement: Flow lifetime and pruning

A flow SHALL live at least 10 minutes from start; when the flow publishes a device code the lifetime SHALL extend to at least `expiresInSeconds + 60` seconds from that event. Pruning SHALL run on every provider-auth request and at least once a minute. A pruned flow that is still pending SHALL be aborted (as in "Flow cancel") before it is forgotten, so no listener or poll outlives its record.

#### Scenario: Long device code outlives the default lifetime
- **WHEN** a device-code flow reports `expiresInSeconds: 900`
- **THEN** `GET /api/provider-auth/flow/:flowId` SHALL still return the flow 12 minutes after start

#### Scenario: Pruning aborts a live flow
- **WHEN** an auth-code flow is pruned while its callback listener is still open
- **THEN** the listener SHALL be closed and a subsequent start for the same provider SHALL not fail with a port-in-use error

### Requirement: OAuth implementation is resolved from the pi runtime dependency

The server SHALL obtain the OAuth provider definitions from `@earendil-works/pi-coding-agent`'s public model-runtime surface, never by importing `@earendil-works/pi-ai` directly or reaching into either package's internal file layout. `packages/server` SHALL declare `@earendil-works/pi-coding-agent` at `^0.86.1` or later, and every other place the repository pins that version (`piCompatibility.minimum`, `piCompatibility.recommended`, the workspace override, the docker image, and the release-dependency gate's own minimum) SHALL agree. On first use the server SHALL verify the runtime exposes provider definitions and that at least one carries an OAuth login; on failure it SHALL log the resolved package version, keep serving every other route, and report the failure in `GET /api/health` so the UI can explain why sign-in is unavailable.

#### Scenario: Correct copy resolved
- **WHEN** the workspace also contains an older hoisted `@earendil-works/pi-ai` without OAuth provider definitions
- **THEN** the server SHALL still build the registry from the copy `@earendil-works/pi-coding-agent` was built against, and the registry SHALL include `meta`

#### Scenario: Runtime surface missing is diagnosable
- **WHEN** the resolved pi-coding-agent copy does not expose provider definitions with OAuth logins
- **THEN** `GET /api/provider-auth/handlers` SHALL return `{ ids: [] }`, `GET /api/health` SHALL carry a non-empty `providerAuth.error` whose text includes the resolved pi-coding-agent version, every provider without a stored OAuth credential SHALL appear in `GET /api/provider-auth/status` as an api-key row under its bare id, and no other route SHALL be affected

#### Scenario: Version pins agree
- **WHEN** the release-dependency gate runs
- **THEN** all six governed pins SHALL resolve `@earendil-works/pi-coding-agent` to the same version, 0.86.1 or later, and the gate SHALL pass

### Requirement: Permanent-key OAuth credentials report no expiry

When a stored OAuth credential has an empty or absent `refresh` token (a permanent key obtained via an OAuth handshake, as OpenRouter issues), `GET /api/provider-auth/status` SHALL emit `expires: null` for that row instead of the stored number, so clients apply one null-check rather than provider-specific knowledge. The shared status type SHALL admit `null` for `expires`.

#### Scenario: OpenRouter status row
- **WHEN** `auth.json` holds `openrouter: { type: "oauth", access, refresh: "", expires }`
- **THEN** the `openrouter` row in `GET /api/provider-auth/status` SHALL have `authenticated: true` and `expires: null`

#### Scenario: Refreshable credential unchanged
- **WHEN** `auth.json` holds an OAuth credential with a non-empty `refresh`
- **THEN** the status row SHALL carry the stored `expires` number as before

### Requirement: Stored OAuth credentials are visible without a registry entry

`GET /api/provider-auth/status` SHALL emit an OAuth row for every `auth.json` entry of `type: "oauth"`, whether or not its id is in the OAuth registry, and `DELETE /api/provider-auth/:provider` SHALL treat such an id as an OAuth row. A row whose id is not in the registry is connected but not re-loginable from the dashboard.

#### Scenario: Credential written by pi for an unregistered provider
- **WHEN** `auth.json` holds `some-future-provider: { type: "oauth", ... }` and the registry does not list that id
- **THEN** `GET /api/provider-auth/status` SHALL list `some-future-provider` as an OAuth row with `authenticated: true`, and `DELETE /api/provider-auth/some-future-provider` SHALL remove it

#### Scenario: Registry failure keeps connected providers visible
- **WHEN** the registry could not be built (see "OAuth implementation is resolved from the pi runtime dependency") and `auth.json` holds an `anthropic` OAuth credential
- **THEN** the `anthropic` OAuth row SHALL still appear as connected and SHALL be removable, while `POST /api/provider-auth/start` for `anthropic` returns 400

### Requirement: New OAuth ids participate in api-key twin naming

Because the OAuth registry now includes `openrouter`, `kimi-coding`, `meta`, and `xai`, the existing collision rule (an api-key row whose catalogue id matches an OAuth id takes the `<id>-api` UI id) SHALL apply to those ids exactly as it does to `anthropic`.

#### Scenario: Stored OpenRouter API key surfaces as the twin row
- **WHEN** `auth.json` holds `openrouter: { type: "api_key", key }` and the catalogue lists `openrouter`
- **THEN** `GET /api/provider-auth/status` SHALL emit an `openrouter` OAuth row with `authenticated: false` and an `openrouter-api` api-key row with `authenticated: true`

## REMOVED Requirements

### Requirement: Auth-code OAuth flow — authorize

**Reason**: Replaced by "Flow start". The server no longer constructs PKCE, state, or authorization URLs, and `flowType` no longer gates which route a provider may use (OpenAI Codex begins with a method choice, GitHub Copilot with a free-text prompt — neither is an auth-code or device-code step). `google-gemini-cli` and `google-antigravity` scenarios described providers pi removed in 0.71.

**Migration**: Clients call `POST /api/provider-auth/start { provider }` and render the returned `authUrl` / `pending` step. Persisted credential shapes are unchanged.

### Requirement: Auth-code OAuth flow — exchange

**Reason**: The code-for-token exchange (PKCE verifier lookup, token endpoint call, provider-specific post-exchange steps such as Codex `accountId` extraction) is performed inside the runtime's flow. No dashboard route performs an exchange; the `POST /api/provider-auth/exchange` route this requirement described was not present in the shipping server before this change either.

**Migration**: Clients observe completion via `GET /api/provider-auth/flow/:flowId` (`status: "complete"`) and submit a manually obtained code via `POST /api/provider-auth/flow/:flowId/input`.

### Requirement: Device-code OAuth flow

**Reason**: Replaced by "Flow start" + "Flow status". Device-code polling, cadence, and the Copilot token exchange are owned by the runtime's flow; `enterpriseDomain` is now a pre-answer to the flow's own prompt rather than a dashboard-side parameter. `GET /api/provider-auth/device-status/:flowId` is replaced by `GET /api/provider-auth/flow/:flowId`.

**Migration**: `POST /device-code { provider, enterpriseDomain }` → `POST /start { provider, enterpriseDomain }`; `GET /device-status/:id` → `GET /flow/:id` (`pending.kind: "device_code"` carries `userCode` / `verificationUri`).

### Requirement: OAuth callback route

**Reason**: The provider's registered `redirect_uri` is `http://localhost:<port>/…`, so the callback is received by the runtime flow's own loopback listener, not by a dashboard route. The `GET /api/provider-auth/callback/:provider` relay page (postMessage / BroadcastChannel / localStorage) described here was not present in the shipping server before this change.

**Migration**: None for clients — completion is observed via `GET /api/provider-auth/flow/:flowId`. Remote browsers use the `manual_code` prompt (paste the redirect URL) instead of a relay page.
