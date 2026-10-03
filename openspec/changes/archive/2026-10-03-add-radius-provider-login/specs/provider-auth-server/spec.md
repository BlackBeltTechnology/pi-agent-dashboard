## MODIFIED Requirements

### Requirement: OAuth provider registry

The server SHALL derive its registry of OAuth providers from the provider definitions of the pi runtime it depends on — every built-in provider that advertises an OAuth login — not from a hand-maintained set of per-provider flow implementations. Each registry entry SHALL expose the provider id, a display name taken from the provider's own OAuth login name, and a `flowType` of `auth_code` or `device_code`. `flowType` is a UI hint (which pane opens first) drawn from a small static table (`anthropic`, `openai-codex`, `openai`, `openrouter`, `radius` → `auth_code`; any other id → `device_code`); it SHALL NOT gate which flows a provider may run. `GET /api/provider-auth/providers` SHALL be derived directly from this registry.

The built-in `radius` provider SHALL be included, because on pi 1.0.0 its OAuth always targets pi's default Radius gateway and needs no dashboard-managed configuration. It SHALL be excluded — from `GET /api/provider-auth/providers`, `GET /api/provider-auth/handlers` and `POST /api/provider-auth/start` — while a **`radius` override** is present: the Pi-global `models.json` (located in pi's agent directory, honouring `PI_CODING_AGENT_DIR`) declares a provider with id `radius` whose `oauth` is `"radius"` and whose `baseUrl` is a non-empty string that, normalized as pi normalizes a Radius gateway (a trailing `/v1` removed, `https://` prepended when no `http(s)://` scheme is present, trailing slashes removed), differs from pi's default Radius gateway. pi sessions then use that custom gateway instead of the built-in one. The file SHALL be parsed exactly as pi 1.0.0 parses `models.json`: a leading BOM stripped, then `//` line comments and trailing commas stripped outside string literals, then `JSON.parse` (block comments are NOT stripped). A missing file, a file whose stripped text `JSON.parse` rejects, or a non-object at any level of the path SHALL count as "no override". pi's schema validation is NOT replicated: a file pi would discard as schema-invalid but that carries the override shape SHALL still count as an override (this errs only toward hiding Radius). Every file for which pi's runtime replaces the built-in `radius` with a non-default gateway SHALL count as an override. The check SHALL reflect file edits without a server restart, and SHALL NOT add any other `models.json`-declared provider to the registry.

On pi 1.0.0 with no `radius` override the registry SHALL contain exactly: `anthropic`, `openai` (Sign in with ChatGPT), `openai-codex`, `github-copilot`, `openrouter`, `kimi-coding`, `meta`, `xai`, `radius`.

#### Scenario: List available OAuth providers
- **WHEN** a client requests `GET /api/provider-auth/providers`
- **THEN** the server SHALL return a JSON array of `{ id, name, flowType }` for every registry entry, with `name` taken from the provider's OAuth login name

#### Scenario: Adding a new OAuth handler is the only required change
- **WHEN** the pi runtime the server resolves adds a built-in provider with an OAuth login
- **THEN** that id SHALL appear in `GET /api/provider-auth/providers` after a server restart with no change to dashboard source, with `flowType: "device_code"` unless the static hint table names it
- **AND** no separately maintained provider list exists to update

#### Scenario: Anthropic method select is driven generically
- **WHEN** a client starts the `anthropic` login on pi 1.0.0, whose first prompt is a `select` with options `browser` and `copy_code`
- **THEN** the flow SHALL surface that prompt as a pending `select` step with both options
- **AND** answering `browser` SHALL continue the flow to the authorization URL with no Anthropic-specific dashboard code

#### Scenario: radius is listed by default
- **WHEN** the resolved pi runtime defines the built-in `radius` provider with an OAuth login and `models.json` has no `radius` override
- **THEN** `GET /api/provider-auth/providers` SHALL include `{ id: "radius", name: "Radius", flowType: "auth_code", subscription: false }`
- **AND** `GET /api/provider-auth/handlers` SHALL include `radius`

#### Scenario: radius is excluded
- **WHEN** `models.json` contains `{ "providers": { "radius": { "oauth": "radius", "baseUrl": "https://gw.example.com/v1" } } }`
- **THEN** `radius` SHALL NOT appear in `GET /api/provider-auth/providers` or `GET /api/provider-auth/handlers`
- **AND** `POST /api/provider-auth/start` with `{ provider: "radius" }` SHALL return 400

#### Scenario: Override in a pi-accepted non-strict JSON file is honoured
- **WHEN** the override above is written in a `models.json` that carries a leading BOM, `//` comments, or trailing commas (each accepted by pi)
- **THEN** `radius` SHALL be excluded

#### Scenario: Override under a custom agent directory
- **WHEN** `PI_CODING_AGENT_DIR` points at a directory whose `models.json` carries the override and `~/.pi/agent/models.json` does not
- **THEN** `radius` SHALL be excluded

#### Scenario: Default-gateway baseUrl is not an override
- **WHEN** `models.json` declares `radius` with `oauth: "radius"` and `baseUrl: "https://radius.pi.dev/v1"`
- **THEN** `radius` SHALL remain in the registry

#### Scenario: Override edit applies without restart
- **WHEN** the `radius` override is removed from `models.json` while the server runs
- **THEN** the next `GET /api/provider-auth/providers` SHALL include `radius`

#### Scenario: Non-overriding models.json entries leave radius listed
- **WHEN** `models.json` is unparseable by pi (for example it uses a `/* */` block comment), or has `"providers": null`, or declares `radius` without `oauth: "radius"`, or declares a different id with `oauth: "radius"`
- **THEN** `radius` SHALL remain in the registry and the other id SHALL NOT be added

#### Scenario: Removed pi providers do not appear
- **WHEN** the catalogue (`providers_list` from the bridge) reports the union of pi's known providers on pi 0.71+
- **THEN** `google-gemini-cli` and `google-antigravity` SHALL NOT appear in either the catalogue or the handler-id list

### Requirement: Flow start

The server SHALL expose `POST /api/provider-auth/start` with body `{ provider, enterpriseDomain? }` that starts the pi runtime's OAuth login for that provider and answers once the flow has produced its first user-facing step. PKCE, state, authorization URLs, the localhost callback listener, device-code polling, and the code-for-token exchange are owned by the runtime's flow; the server SHALL NOT construct any of them. The response SHALL be the flow's status (see "Flow status") including `flowId`. When the flow publishes an authorization URL the server SHALL open it in the local browser where one is available. When `enterpriseDomain` is supplied it SHALL be used to answer the flow's first free-text prompt without that prompt ever being reported as pending.

#### Scenario: Start Anthropic
- **WHEN** a client requests `POST /api/provider-auth/start` with `{ provider: "anthropic" }`
- **THEN** the server SHALL return HTTP 200 with `flowId`, `authUrl`, and `pending: { kind: "manual_code", ... }` in the same response

#### Scenario: Start OpenAI Codex
- **WHEN** a client requests `POST /api/provider-auth/start` with `{ provider: "openai-codex" }`
- **THEN** the server SHALL return HTTP 200 with `flowId` and `pending: { kind: "select", options }` naming the browser and device-code login methods, and no `authUrl` yet

#### Scenario: Start Radius
- **WHEN** a client requests `POST /api/provider-auth/start` with `{ provider: "radius" }` and no `models.json` override
- **THEN** the server SHALL return HTTP 200 with `flowId` and `pending: { kind: "select", options }` whose option ids are `browser` and `device-code`, with no Radius-specific dashboard code involved
- **AND** answering `device-code` SHALL move the flow to `pending: { kind: "device_code", userCode, verificationUri, ... }`
- **AND** on completion the credential SHALL be persisted under key `radius` exactly as the runtime's flow returned it
- **AND** when the user answers `browser` while the Radius callback port is bound by another process, the flow SHALL report `status: "error"` with an `error` naming the port (the `/start` response already returned 200, because the port is bound only after the method choice)

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
- **WHEN** a flow binds its localhost callback before its first user-facing step (for example Anthropic's) and that port is already in use by something the server does not own (for example a pi session running `/login` on the same host)
- **THEN** `POST /api/provider-auth/start` SHALL return HTTP 500 with `{ error }` naming the port, and no flow SHALL remain pending

#### Scenario: Provider does not respond
- **WHEN** the flow produces neither a user-facing step nor a failure within 15 seconds of start
- **THEN** the server SHALL abort the flow and return HTTP 504 with `{ error: "Provider did not respond" }`

#### Scenario: Unknown or excluded provider
- **WHEN** a client requests `POST /api/provider-auth/start` with a provider id not in the registry (including `radius` while `models.json` overrides it, `google-gemini-cli`, `google-antigravity`, and api-key-only ids)
- **THEN** the server SHALL return HTTP 400 with `{ error: "Unknown OAuth provider: <id>" }`

### Requirement: New OAuth ids participate in api-key twin naming

Because the OAuth registry now includes `openrouter`, `kimi-coding`, `meta`, `xai` and `radius`, the existing collision rule (an api-key row whose catalogue id matches an OAuth id takes the `<id>-api` UI id) SHALL apply to those ids exactly as it does to `anthropic`. While `radius` is excluded by a `models.json` override and `auth.json` holds no `radius` OAuth credential, `radius` is not an OAuth id and its api-key row SHALL keep the bare id; a stored `radius` OAuth credential keeps it an OAuth id (see "Stored OAuth credentials are visible without a registry entry") and the twin naming applies.

#### Scenario: Stored OpenRouter API key surfaces as the twin row
- **WHEN** `auth.json` holds `openrouter: { type: "api_key", key }` and the catalogue lists `openrouter`
- **THEN** `GET /api/provider-auth/status` SHALL emit an `openrouter` OAuth row with `authenticated: false` and an `openrouter-api` api-key row with `authenticated: true`

#### Scenario: RADIUS_API_KEY surfaces as the Radius twin row
- **WHEN** `RADIUS_API_KEY` is set, `auth.json` has no `radius` entry, and the catalogue reports `radius` as `{ configured: true, source: "environment", envVar: "RADIUS_API_KEY" }`
- **THEN** `GET /api/provider-auth/status` SHALL emit a `radius-api` row named "Radius (API Key)" with `configured: true`, `source: "environment"` and `envVar: "RADIUS_API_KEY"`, and a `radius` OAuth row with `configured: false`

### Requirement: Server exposes registered handler ids

The server SHALL expose `GET /api/provider-auth/handlers` returning `{ ids: string[] }` — the list of provider ids the dashboard can drive a login flow for, equal to the OAuth provider registry's id set. Distinct from the catalogue (the union of pi's providers): a catalogue id absent from `ids` is an OAuth provider the UI knows about but the dashboard cannot complete a login for. This endpoint imposes no rendering obligation on the UI.

#### Scenario: Default handler ids
- **WHEN** the server starts against pi 1.0.0 and `models.json` has no `radius` override
- **THEN** `GET /api/provider-auth/handlers` returns `{ ids }` containing exactly `anthropic`, `openai`, `openai-codex`, `github-copilot`, `openrouter`, `kimi-coding`, `meta`, `xai`, `radius` in any order

#### Scenario: Handler ids under a radius override
- **WHEN** the server runs against pi 1.0.0 and `models.json` carries a `radius` override
- **THEN** `GET /api/provider-auth/handlers` returns the default ids without `radius`

#### Scenario: Catalogue lists provider not in handlers
- **WHEN** the bridge has pushed a catalogue containing `{ id: "custom-llm", hasOAuth: true }` (e.g. from `pi.registerProvider({ oauth: ... })`)
- **AND** `GET /api/provider-auth/handlers` returns ids without `custom-llm`
- **THEN** `GET /api/provider-auth/status` SHALL NOT emit `custom-llm` as an OAuth row, because OAuth rows are built from the registry only
- **AND** `POST /api/provider-auth/start` for `custom-llm` SHALL return 400 with `error: "Unknown OAuth provider: custom-llm"`

### Requirement: Status rows carry the auth label and the subscription flag

`GET /api/provider-auth/status` SHALL copy the catalogue entry's `authLabel` onto a configured, environment-sourced api-key row, and SHALL report `authenticated: true` for that row when it has `authLabel`, no stored key, no `envVar` and is not `ambient` (an environment credential pi resolves itself, like `ambient`). Because pi labels every environment credential, an env-var row keeps its existing `authenticated` value. Each OAuth registry entry and OAuth status row SHALL carry `subscription` (boolean), taken from the pi provider's OAuth `isSubscription` (absent → `false`). On pi 1.0.0 every registry provider except `openrouter` and `radius` reports `subscription: true`.

#### Scenario: Federation row
- **WHEN** the catalogue reports `anthropic` as `{ configured: true, source: "environment", authLabel: "workload identity federation" }` and nothing is stored
- **THEN** the `anthropic-api` row SHALL report `configured: true`, `authenticated: true`, `source: "environment"`, `authLabel: "workload identity federation"`
- **AND** the `anthropic` OAuth row SHALL report `configured: false`

#### Scenario: Env-var row is not promoted by its label
- **WHEN** the catalogue reports `anthropic` as `{ configured: true, source: "environment", envVar: "ANTHROPIC_API_KEY", authLabel: "ANTHROPIC_API_KEY" }`
- **THEN** the `anthropic-api` row SHALL report `authenticated: false`

#### Scenario: Subscription flag
- **WHEN** a client requests `GET /api/provider-auth/providers` against pi 1.0.0
- **THEN** `anthropic` SHALL report `subscription: true`, and `openrouter` and `radius` SHALL report `subscription: false`

### Requirement: OAuth implementation is resolved from the pi runtime dependency

The server SHALL obtain the OAuth provider definitions from `@earendil-works/pi-coding-agent`'s public model-runtime surface, never by importing `@earendil-works/pi-ai` directly or reaching into either package's internal file layout. Test code that asserts parity between a dashboard constant or predicate and pi's internal behaviour (a drift test) MAY read pi's internal files; server runtime code SHALL NOT. `packages/server` SHALL declare `@earendil-works/pi-coding-agent` at `^1.0.0` (see pi-core-version-check), and every other place the repository pins that version (`piCompatibility.minimum`, `piCompatibility.recommended`, the workspace override, the docker image, and the release-dependency gate's own minimum) SHALL agree. On first use the server SHALL verify the runtime exposes provider definitions and that at least one carries an OAuth login; on failure it SHALL log the resolved package version, keep serving every other route, and report the failure in `GET /api/health` so the UI can explain why sign-in is unavailable.

#### Scenario: Correct copy resolved
- **WHEN** the workspace also contains an older hoisted `@earendil-works/pi-ai` without OAuth provider definitions
- **THEN** the server SHALL still build the registry from the copy `@earendil-works/pi-coding-agent` was built against, and the registry SHALL include `meta`

#### Scenario: Runtime surface missing is diagnosable
- **WHEN** the resolved pi-coding-agent copy does not expose provider definitions with OAuth logins
- **THEN** `GET /api/provider-auth/handlers` SHALL return `{ ids: [] }`, `GET /api/health` SHALL carry a non-empty `providerAuth.error` whose text includes the resolved pi-coding-agent version, every provider without a stored OAuth credential SHALL appear in `GET /api/provider-auth/status` as an api-key row under its bare id, and no other route SHALL be affected

#### Scenario: Version pins agree
- **WHEN** the release-dependency gate runs
- **THEN** all governed pins SHALL resolve `@earendil-works/pi-coding-agent` to the same version, 1.0.0 or later, and the gate SHALL pass

#### Scenario: Drift test may read pi internals
- **WHEN** a dashboard test asserts that the server's `RADIUS_MCP_URL` constant equals pi's internal value
- **THEN** the test MAY resolve pi's internal module by walking `node_modules`, and no server runtime module SHALL import it

## ADDED Requirements

### Requirement: Radius MCP server configuration

The server SHALL expose `GET /api/provider-auth/radius/mcp` and `POST /api/provider-auth/radius/mcp`, operating on the Pi-global `mcp.json` only and mirroring pi 1.0.0's `/login` follow-up. Both routes SHALL sit behind the server-wide gates that cover every `/api/*` route (universal network guard, route-tier gate, and — for `POST` — the mutation-origin gate). Each SHALL carry a route-tier entry (`operate`) and SHALL be accounted for in the MCP tool manifest on the same terms as every other `/api/*` route (the existing `/api/provider-auth/` denylist prefix covers them). The Radius MCP URL SHALL equal pi's `RADIUS_MCP_URL` (`https://radius.pi.dev/mcp` on pi 1.0.0). URL comparison SHALL ignore trailing slashes.

`GET` SHALL answer HTTP 503 (`runtime-unavailable`) when the pi runtime surface needed to locate the agent directory could not be loaded; otherwise `{ configured, path, name }`:
- `configured` is true when a global HTTP entry with the Radius MCP URL already carries `auth.provider: "radius"`.
- `name` is the entry name a configure would write: the URL-matched entry's name; else `radius`; else `radius-mcp` when another server already uses `radius`.
- `path` is the absolute global `mcp.json` path.

It SHALL answer `configured: false` with HTTP 200 when the file is absent, and HTTP 409 `provider_auth.radius_mcp_write_refused` (`reason: "unparseable"`) when the file cannot be parsed. The computed `name` reflects the global file only; a name the writer later refuses (e.g. a `-`/`_` collision with a trusted folder's entry) surfaces as a `POST` refusal.

Every refusal body SHALL carry `error` text plus a stable domain-prefixed `code` the client maps to an `err.*` translation key, following the provider-auth convention (`provider_auth.credential_type_conflict`): `provider_auth.radius_mcp_runtime_unavailable`, `provider_auth.radius_mcp_no_credential`, `provider_auth.radius_mcp_overridden`, or `provider_auth.radius_mcp_write_refused` with `vars.reason` set to the writer's refusal code (e.g. `unparseable`, `name-collision`). `POST` SHALL evaluate in this order and stop at the first match, leaving `mcp.json` untouched on any refusal:
1. runtime unavailable → HTTP 503 `provider_auth.radius_mcp_runtime_unavailable` (the override check cannot be trusted);
2. no `radius` OAuth credential in `auth.json` → HTTP 409 `provider_auth.radius_mcp_no_credential`;
3. `models.json` `radius` override present → HTTP 409 `provider_auth.radius_mcp_overridden`;
4. `mcp.json` unparseable → HTTP 409 `provider_auth.radius_mcp_write_refused` (`reason: "unparseable"`);
5. already configured (as `GET` defines it) → no-op `{ configured: true, written: false }`;
6. otherwise write. The write SHALL touch exactly one global entry through the `mcp-client` config writer's single-entry save operation (defined by `migrate-mcp-to-pi-builtin`; this requirement cannot be implemented before that change lands): either the URL-matched entry with `auth: { provider: "radius" }` set and its `oauth` key removed, or a new `{ url, auth: { provider: "radius" } }` entry under the computed name. Within that write, every other entry and key SHALL be preserved. A writer refusal SHALL map to HTTP 409 `provider_auth.radius_mcp_write_refused` with `vars.reason`, and nothing SHALL be written. After a successful write the server SHALL dispatch `/reload` to every reload fan-out target through `dispatchReload`, and answer `{ configured: true, written: true, name, reloaded }`, where `reloaded` counts only targets whose outcome was an actual reload (`respawn` or `forwarded`) — a busy (`refused`) or undeliverable (`error`) target SHALL NOT be counted. Neither the request body, nor credentials, nor any header value SHALL be logged.

#### Scenario: Configure on a fresh install
- **WHEN** a `radius` OAuth credential is stored, `mcp.json` has no server with the Radius MCP URL and no server named `radius`, and a client posts `POST /api/provider-auth/radius/mcp`
- **THEN** `mcp.json` SHALL contain `mcpServers.radius = { url: "https://radius.pi.dev/mcp", auth: { provider: "radius" } }`
- **AND** the response SHALL carry `written: true` and every fan-out target SHALL have been dispatched `/reload` via `dispatchReload`

#### Scenario: Busy session is not counted as reloaded
- **WHEN** a write succeeds with three fan-out targets of which one is streaming and refused by `dispatchReload`
- **THEN** the response SHALL carry `reloaded: 2`

#### Scenario: Existing URL entry is upgraded in place
- **WHEN** `mcp.json` holds `mcpServers.gw = { url: "https://radius.pi.dev/mcp/", oauth: { clientId: "x" }, exposure: "codemode" }`
- **THEN** after `POST` the entry `gw` SHALL be `{ url: "https://radius.pi.dev/mcp/", exposure: "codemode", auth: { provider: "radius" } }` with no `oauth` key and no new entry added

#### Scenario: Name taken by another server
- **WHEN** `mcp.json` holds an unrelated server named `radius` and no entry with the Radius MCP URL
- **THEN** `GET` SHALL report `name: "radius-mcp"` and `POST` SHALL write the new entry under `radius-mcp`, leaving the other `radius` entry untouched

#### Scenario: Already configured
- **WHEN** a global entry with the Radius MCP URL already has `auth.provider: "radius"`
- **THEN** `GET` SHALL report `configured: true` and `POST` SHALL answer `written: false`, write nothing, and dispatch no reload

#### Scenario: No Radius credential
- **WHEN** `auth.json` holds no `radius` OAuth credential and a client posts `POST /api/provider-auth/radius/mcp`
- **THEN** the server SHALL return 409 with `code: "provider_auth.radius_mcp_no_credential"` and SHALL NOT touch `mcp.json`

#### Scenario: Already configured but signed out
- **WHEN** a global entry with the Radius MCP URL already has `auth.provider: "radius"` and `auth.json` holds no `radius` OAuth credential
- **THEN** `POST` SHALL return 409 with `code: "provider_auth.radius_mcp_no_credential"` (refusals are evaluated before the no-op)

#### Scenario: Override present
- **WHEN** a `radius` OAuth credential is stored and `models.json` carries a `radius` override
- **THEN** `POST` SHALL return 409 with `code: "provider_auth.radius_mcp_overridden"` and SHALL NOT touch `mcp.json`

#### Scenario: Runtime unavailable
- **WHEN** the pi-coding-agent module could not be loaded (the OAuth registry reports an error) and a client posts `POST /api/provider-auth/radius/mcp`
- **THEN** `POST` and `GET` SHALL return 503 with `code: "provider_auth.radius_mcp_runtime_unavailable"`, and `mcp.json` SHALL NOT be touched

#### Scenario: Writer collision refusal is surfaced
- **WHEN** the computed name collides in `-`/`_` form with an entry of a known trusted folder's project layer
- **THEN** `POST` SHALL return 409 with `code: "provider_auth.radius_mcp_write_refused"` and `vars.reason: "name-collision"`, write nothing, and dispatch no reload

#### Scenario: Unparseable mcp.json is refused
- **WHEN** the global `mcp.json` is not parseable
- **THEN** `GET` and `POST` SHALL return 409 with `code: "provider_auth.radius_mcp_write_refused"` and `vars.reason: "unparseable"`, the file bytes SHALL be unchanged, and no reload SHALL be dispatched

#### Scenario: Routes are tiered and manifest-accounted
- **WHEN** the MCP manifest completeness check and the route-tier table are evaluated
- **THEN** both routes SHALL have an `operate` route-tier entry and SHALL be accounted for by the MCP tool manifest (denylisted via the `/api/provider-auth/` prefix)
