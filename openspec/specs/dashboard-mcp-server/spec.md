# dashboard-mcp-server Specification

## Purpose
TBD - created by archiving change add-dashboard-mcp-server. Update Purpose after archive.

## Requirements

### Requirement: server/discover is implemented
The server SHALL implement the `server/discover` RPC, advertising its supported
protocol versions, its capabilities, and its identity.

#### Scenario: Discovery advertises identity and versions
- **WHEN** a client calls `server/discover`
- **THEN** the response SHALL list every protocol version the server supports
- **AND** it SHALL carry `io.modelcontextprotocol/serverInfo` identifying the dashboard and its version

#### Scenario: Discovery is repeatable and side-effect free
- **WHEN** `server/discover` is called twice from different connections
- **THEN** both responses SHALL be equivalent
- **AND** neither SHALL create server-side state

### Requirement: Tool surface is a guarded allowlist over the plugin server context
Advertised tools SHALL be backed by an explicit allowlist of
`ServerPluginContext` capabilities. The allowlist SHALL be hand-maintained and
guarded by an automated completeness check. The server SHALL NOT advertise a
tool for every member of the browser command verb union, nor for every member of
the plugin server context.

#### Scenario: Curated surface, not the full verb union
- **WHEN** a client calls `tools/list`
- **THEN** the result SHALL NOT contain a tool for a UI-only verb such as `reorder_pinned_dirs` or `set_session_process_drawer`
- **AND** it SHALL NOT contain a tool for a transport verb such as `subscribe` or `watch_files`

#### Scenario: Every advertised tool has a handler
- **WHEN** the advertised tool table is enumerated
- **THEN** each entry SHALL resolve to an invocable handler
- **AND** a tool without a resolvable handler SHALL fail the build

#### Scenario: Non-allowlisted context members are not exposed
- **WHEN** the advertised tool table is enumerated
- **THEN** it SHALL NOT expose `registerPiHandler`, `registerBrowserHandler`, `broadcastToSubscribers`, `emitEventToSession`, or the raw Fastify instance

#### Scenario: Abort uses the general session primitive
- **WHEN** an `abort` tool is invoked for a session
- **THEN** it SHALL target the general session-abort primitive
- **AND** it SHALL NOT be backed by the plugin-spawned-run hard-kill primitive

#### Scenario: Session id is an ordinary tool argument
- **WHEN** a tool operates on a session
- **THEN** the target session SHALL be identified by a `sessionId` argument in the tool's `arguments` object
- **AND** the server SHALL NOT rely on connection-scoped state to determine the target

### Requirement: Every /mcp request is authenticated, including loopback
The endpoint SHALL require a valid token on every request, presented as
`Authorization: Bearer <token>`. `/mcp` SHALL NOT honour the loopback allowance
that exempts genuinely-local requests from authentication on other routes. That
allowance SHALL remain unchanged for all other routes. The endpoint SHALL NOT
introduce an OAuth flow and SHALL NOT bind an OAuth callback port.

#### Scenario: Missing or invalid credential is refused
- **WHEN** a request arrives with no `Authorization` header, or with a token that is not valid
- **THEN** the server SHALL reject the request
- **AND** it SHALL NOT execute any tool

#### Scenario: Loopback does not bypass authentication
- **WHEN** a request to `/mcp` originates from a genuinely-local address with no `Authorization` header
- **THEN** the server SHALL reject the request

#### Scenario: Other routes retain the loopback allowance
- **WHEN** a genuinely-local request with no credential is made to a non-`/mcp` route that previously allowed it
- **THEN** that request SHALL continue to be allowed

#### Scenario: Revoked credential loses access immediately
- **WHEN** a credential is revoked
- **AND** a subsequent `/mcp` request presents it
- **THEN** the request SHALL be refused

#### Scenario: Credential is required per request, not per connection
- **WHEN** a client sends a second request without an `Authorization` header after a successful authenticated request
- **THEN** the second request SHALL be refused

### Requirement: Plugin pi-message handlers receive a server-attributed session id
The plugin server context SHALL deliver the originating session id alongside
every bridge message dispatched to a `registerPiHandler` handler. The id SHALL be
supplied by the pi gateway from the connection the message arrived on, and SHALL
NOT be read from the message body.

#### Scenario: Handler receives the gateway's session id
- **WHEN** a bridge message is dispatched to a registered pi handler
- **THEN** the handler SHALL receive the id of the session whose connection carried it

#### Scenario: A body-supplied session id does not influence attribution
- **WHEN** a bridge message body contains a field naming a different session
- **THEN** the attributed session SHALL remain the connection's own session

#### Scenario: Existing single-argument handlers keep working
- **WHEN** a handler is registered that accepts only the message argument
- **THEN** it SHALL continue to be dispatched without error

### Requirement: Per-session MCP tokens carry caller identity
The dashboard SHALL be able to mint a session-scoped MCP token whose originating
session is recorded server-side. Caller identity SHALL be derived from the
presented token and SHALL NOT be derived from any client-supplied claim.

#### Scenario: Session token resolves to its originating session
- **WHEN** a request presents a session-scoped MCP token
- **THEN** the server SHALL resolve the caller's originating session id from server-side records

#### Scenario: Client-declared identity is not trusted
- **WHEN** a request carries a client-supplied field asserting its own session id
- **THEN** the server SHALL NOT use that field to determine caller identity

#### Scenario: Device-scoped token has no originating session
- **WHEN** a request presents a device-scoped paired-device token
- **THEN** the caller SHALL be treated as having no originating session

#### Scenario: Session token dies with its session
- **WHEN** the session that a token was minted for ends
- **THEN** that token SHALL no longer authenticate a request

### Requirement: A session cannot drive itself through the MCP endpoint
The server SHALL refuse a tool call whose target session equals the caller's
server-resolved originating session. This SHALL apply to every session-targeting
tool, including prompt delivery that routes to extension-command dispatch.

#### Scenario: Self-targeted prompt is refused
- **WHEN** a caller whose originating session resolves to `A` invokes a session-targeting tool with `sessionId` equal to `A`
- **THEN** the server SHALL refuse the call
- **AND** it SHALL NOT deliver the prompt

#### Scenario: Self-targeted slash command is refused
- **WHEN** a caller whose originating session resolves to `A` invokes prompt delivery targeting `A` with text beginning `/`
- **THEN** the server SHALL refuse the call
- **AND** it SHALL NOT reach extension-command dispatch

#### Scenario: Cross-session control is permitted
- **WHEN** a caller whose originating session resolves to `A` targets a different session `B`
- **THEN** the call SHALL be permitted subject to the remaining authorization rules

#### Scenario: Sessionless caller is unaffected
- **WHEN** a caller with no originating session targets any session
- **THEN** the self-target guard SHALL NOT refuse the call

#### Scenario: Refusal is observable
- **WHEN** a self-targeted call is refused
- **THEN** the refusal SHALL be recorded with the resolved caller session, the target session, and the tool name

### Requirement: Event streaming uses subscriptions/listen with per-subscription filtering
Server-to-client event delivery SHALL use `subscriptions/listen` as a long-lived
POST-response stream. The server SHALL deliver only events for the sessions a
given subscription requested. The server SHALL NOT expose a standalone HTTP GET
stream, and SHALL NOT implement `resources/subscribe` or `resources/unsubscribe`.
Streaming is a modern-era feature: legacy-era requests SHALL NOT open a stream.

#### Scenario: Listen delivers subscribed session events
- **WHEN** a client opens `subscriptions/listen` for session `A` and `A` emits an event
- **THEN** the event SHALL be delivered on that request's response stream

#### Scenario: Unsubscribed sessions do not leak
- **WHEN** a client opens `subscriptions/listen` for session `A` and a different session `B` emits an event
- **THEN** that event SHALL NOT be delivered on the subscription scoped to `A`

#### Scenario: Stream teardown releases the subscription
- **WHEN** a `subscriptions/listen` response stream is closed by the client or the transport
- **THEN** the underlying event subscription SHALL be released

#### Scenario: Legacy subscription methods are absent
- **WHEN** a client calls `resources/subscribe` or `resources/unsubscribe`
- **THEN** the server SHALL report the method as unsupported

#### Scenario: Legacy era cannot open a stream
- **WHEN** a request resolved to a legacy revision calls `subscriptions/listen`
- **THEN** the server SHALL respond `404` with JSON-RPC error `-32601`
- **AND** the server SHALL NOT open a stream

#### Scenario: Listen is subject to version resolution
- **WHEN** a `subscriptions/listen` request carries an `MCP-Protocol-Version: 2026-07-28` header but no `params._meta` version, or declares an unsupported version, or has a header/body mismatch
- **THEN** the server SHALL refuse it with the same error any other method receives for that input
- **AND** the server SHALL NOT open a stream

#### Scenario: Subscription filter names its sessions explicitly
- **WHEN** a client calls `subscriptions/listen`
- **THEN** the server SHALL read the requested sessions from a `sessionIds` array in `params`

#### Scenario: An absent or empty session filter is a request error
- **WHEN** a `subscriptions/listen` request omits `sessionIds`, supplies an empty array, or supplies a non-array
- **THEN** the server SHALL return JSON-RPC error `-32602`
- **AND** the server SHALL NOT open a stream
- **AND** the server SHALL NOT interpret the request as a subscription to every session

#### Scenario: A slow consumer is bounded
- **WHEN** a subscriber stops reading while events continue to arrive
- **THEN** the server SHALL bound its buffering per subscription
- **AND** the server SHALL terminate the subscription once its buffer limit is reached
- **AND** the server SHALL NOT silently drop events from a still-open subscription

### Requirement: Dashboard MCP entry is provisioned into the user MCP config
The dashboard SHALL provision its own entry into the adapter's Pi-global config file (`~/.pi/agent/mcp.json` by default, resolved through the adapter's path helper so a custom agent directory is honoured) so a local pi session can reach the endpoint. The write SHALL go through the MCP client package's core writer (a package dependency, not a plugin dependency), sharing its JSONC parsing, servers-key alias handling, hardened atomic IO and refusal set. The entry SHALL declare a protocol version selection that negotiates or pins the modern era rather than relying on the adapter's legacy default.

#### Scenario: Entry declares protocol negotiation
- **WHEN** the dashboard writes its `mcpServers` entry
- **THEN** the entry SHALL set a protocol version selection of `auto` or a pinned `2026-07-28`
- **AND** it SHALL NOT omit the protocol version selection

#### Scenario: Entry uses the HTTP server shape
- **WHEN** the dashboard writes its `mcpServers` entry
- **THEN** the entry SHALL declare the endpoint by `url`
- **AND** it SHALL NOT use the stdio `command` shape used for local stdio servers

#### Scenario: Entry occupies the reserved pi-dashboard key
- **WHEN** the dashboard writes its `mcpServers` entry
- **THEN** it SHALL be written under the key `pi-dashboard`

#### Scenario: A foreign entry under the reserved key is never clobbered
- **WHEN** the Pi-global file's servers already hold an entry under `pi-dashboard` that does not declare a `url` (checked by a layer-level read of that file only)
- **THEN** the writer SHALL refuse the write and surface an error
- **AND** the existing file SHALL be left unmodified

#### Scenario: An existing dashboard entry is refreshed
- **WHEN** `mcpServers` already holds an entry under `pi-dashboard` that declares a `url`
- **THEN** the writer SHALL update every field the dashboard owns (`url`, the protocol version selection) to the current values
- **AND** operator-added fields on that entry (for example `disabled` or `headers`) SHALL be preserved

#### Scenario: Sibling entries are preserved
- **WHEN** the write occurs and the file already contains other `mcpServers` entries
- **THEN** every sibling entry SHALL be preserved unchanged

#### Scenario: Write is atomic
- **WHEN** the write occurs
- **THEN** it SHALL be performed via a temporary file and rename
- **AND** a partially-written file SHALL never be observable

#### Scenario: Unparseable config is refused, not repaired
- **WHEN** the existing file is present but the adapter's own parser (JSON with comments and trailing commas) cannot parse it
- **THEN** the write SHALL be refused and surfaced
- **AND** the existing file SHALL be left unmodified

#### Scenario: Server name does not collide
- **WHEN** the entry is written
- **THEN** its server name SHALL NOT be one already owned by another provisioner

#### Scenario: Commented config is provisioned
- **WHEN** the existing file contains comments or trailing commas that the adapter parses
- **THEN** the dashboard entry is written and every other entry is preserved

#### Scenario: Alias servers key is preserved
- **WHEN** the existing file defines servers under `mcp-servers`
- **THEN** the entry is written under `mcp-servers`
- **AND** no `mcpServers` key is added

#### Scenario: Custom agent directory is provisioned
- **WHEN** `PI_CODING_AGENT_DIR` points at a custom directory
- **THEN** the dashboard entry is written to `<custom>/mcp.json`

### Requirement: Endpoint naming avoids collision with the pi MCP adapter
Dashboard surfaces added by this change SHALL NOT claim names owned by
`pi-mcp-adapter`.

#### Scenario: Command palette entry does not shadow the adapter
- **WHEN** the plugin declares a `command-route` claim
- **THEN** the claimed command SHALL NOT be `/mcp`

#### Scenario: No OAuth callback port is bound
- **WHEN** the MCP endpoint starts
- **THEN** it SHALL NOT bind an OAuth callback port

### Requirement: Adapter version floor is consumed, not probed

The dashboard MCP server plugin SHALL NOT own a `pi-mcp-adapter` version probe. When it needs the adapter verdict (for the provisioning surface or diagnostics) it SHALL consume the `mcp-client.config` service at call time. The plugin SHALL NOT declare `dependsOn: ["mcp-client"]`, so the dashboard endpoint keeps working when the MCP client plugin is disabled.

#### Scenario: Verdict sourced from mcp-client

- **WHEN** the provisioning surface reports the adapter version state and `mcp-client` is enabled
- **THEN** the reported verdict equals the one `mcp-client` reports

#### Scenario: Absent mcp-client degrades to unknown

- **WHEN** `mcp-client` is disabled or absent
- **THEN** the adapter version state is reported as unknown
- **AND** the MCP endpoint itself remains available

#### Scenario: Below-floor warning moves to the first MCP request

- **WHEN** the installed adapter is below the floor and the first request reaches the plugin's `/mcp` route
- **THEN** the plugin logs the below-floor warning once
- **AND** no warning is logged at registration

### Requirement: A local pi session obtains a working /mcp credential without manual configuration
A pi session running on the same machine as the dashboard SHALL be able to reach
`/mcp` through the provisioned `pi-dashboard` MCP entry using only credentials the
system delivers to it. The operator SHALL NOT be required to hand-edit an MCP
config file, copy a token, or run a pairing flow to make the local path work.

The delivered credential SHALL resolve to a caller identity the server itself
recorded. It SHALL NOT be derived from anything the MCP client asserts.

#### Scenario: Provisioned entry authenticates out of the box
- **WHEN** a pi session on the dashboard's own machine connects through the provisioned `pi-dashboard` entry
- **THEN** the request SHALL be authenticated
- **AND** the session SHALL be able to invoke an advertised tool

#### Scenario: No hand-editing is required
- **WHEN** the dashboard has provisioned its MCP entry and no operator has edited an MCP config file
- **THEN** the local pi path SHALL still authenticate

#### Scenario: An unauthenticated caller is still refused
- **WHEN** a request reaches `/mcp` without the delivered credential
- **THEN** it SHALL be refused exactly as before this change

### Requirement: The delivered credential is bound to the session it was delivered to
The credential delivered to a pi session SHALL identify that session to the
server, so a call made through it resolves to `{originating session: that
session}`. The self-target guard SHALL therefore remain enforceable for every
locally-provisioned caller.

#### Scenario: Caller resolves to the session it was delivered to
- **WHEN** session `A` invokes a tool using its delivered credential
- **THEN** the server SHALL resolve the caller's originating session as `A`

#### Scenario: Self-target guard still fires on the local path
- **WHEN** session `A` invokes a session-targeting tool with `sessionId` equal to `A` using its delivered credential
- **THEN** the call SHALL be refused

#### Scenario: A credential is not usable to impersonate another session
- **WHEN** a credential delivered to session `A` is presented on a request that claims to originate from session `B`
- **THEN** the resolved caller SHALL remain `A`

### Requirement: Delivered credentials survive neither a restart nor the session's end
Because the token registry is in-memory, a dashboard restart SHALL invalidate
every delivered credential. The delivery path SHALL re-run so a session recovers
a working credential without operator action, and SHALL NOT leave a credential on
disk that the server no longer honours.

#### Scenario: Restart re-delivers rather than stranding
- **WHEN** the dashboard restarts while a pi session is running
- **AND** the session's bridge reconnects
- **THEN** a fresh credential SHALL be delivered to that session
- **AND** the session SHALL reach `/mcp` again without operator action

#### Scenario: A stale credential is not left behind
- **WHEN** a session ends, or its credential is revoked
- **THEN** any on-disk copy of that credential SHALL be removed or replaced
- **AND** presenting it SHALL be refused

#### Scenario: Delivery failure is surfaced, never silent
- **WHEN** credential delivery fails
- **THEN** the failure SHALL be logged with the affected session id
- **AND** the dashboard SHALL continue serving `/mcp` to other callers

#### Scenario: Delivery failure is logged by the side that can see it
- **WHEN** delivery fails on the session side, where the MCP client discards the credential command's diagnostics
- **THEN** the failure SHALL be logged by a component that holds the session id
- **AND** the log line SHALL identify the affected session
- **AND** a failure that is structurally invisible to the server SHALL NOT be the only record of it

### Requirement: One session's credential failures do not lock out the others
Because every local session reaches `/mcp` from the same loopback address, the
brute-force control SHALL NOT treat all local sessions as one source. A session
presenting a stale or invalid credential SHALL NOT deny service to other local
sessions holding valid ones.

#### Scenario: A stale credential does not throttle healthy sessions
- **WHEN** one local session repeatedly presents a credential the server no longer honours
- **AND** the failure count for that session exceeds the brute-force threshold
- **THEN** another local session presenting a valid credential SHALL still be served

#### Scenario: Post-restart recovery is not self-blocking
- **WHEN** the dashboard restarts and several live local sessions retry with their now-invalid credentials
- **THEN** the re-delivery path SHALL still complete for each of them
- **AND** the retry traffic SHALL NOT lock the loopback source out of its own recovery

#### Scenario: Brute-force protection still applies
- **WHEN** an unauthenticated caller guesses credentials repeatedly
- **THEN** it SHALL still be throttled

### Requirement: A credential written to disk is protected and never clobbers operator config
Where credential delivery writes to an MCP config file, the write SHALL use the
same hardened atomic path as the existing provisioning write, SHALL restrict the
file's permissions to the owning user, and SHALL preserve every field the
dashboard does not own.

#### Scenario: File is owner-only
- **WHEN** a credential is written into an MCP config file
- **THEN** that file SHALL NOT be readable by other users on the machine

#### Scenario: Operator-added fields survive
- **WHEN** the entry already carries operator-added fields such as `disabled`
- **THEN** those fields SHALL be preserved by the credential write

#### Scenario: Write is atomic
- **WHEN** the credential write occurs
- **THEN** a partially-written config file SHALL never be observable

#### Scenario: Credential is not logged
- **WHEN** delivery succeeds or fails
- **THEN** the plaintext credential SHALL NOT appear in any log line

### Requirement: Dual-era MCP endpoint
The dashboard SHALL expose a single MCP endpoint at `POST /mcp` serving two
protocol eras, selected by the declared protocol version of each request:

- **Modern era** — revision `2026-07-28`. Stateless at the protocol layer: the
  server SHALL NOT mint, echo, or honour session identifiers and SHALL NOT
  require an `initialize` handshake. No request SHALL depend on state
  established by a previous request. A `subscriptions/listen` stream is scoped
  to its own request and does not constitute cross-request state.
- **Legacy era** — revisions `2025-03-26`, `2025-06-18` and `2025-11-25`. The
  server SHALL answer the `initialize` handshake, accept every
  `notifications/*` message, answer `ping`, and emit an `Mcp-Session-Id`
  response header on `initialize`. The identifier is a compatibility token
  only: request dispatch SHALL NOT depend on it, and the server SHALL NOT keep
  per-session state keyed by it.

Version resolution SHALL happen once per request, before any method-specific
handling, and SHALL apply to every method including `subscriptions/listen`.

#### Scenario: GET and DELETE are rejected with 405
- **WHEN** an HTTP `GET` or `DELETE` is issued to `/mcp`
- **THEN** the server SHALL respond `405 Method Not Allowed`

#### Scenario: 405 holds in development mode
- **WHEN** the server runs in `--dev` mode with the Vite proxy active
- **AND** an HTTP `GET` is issued to `/mcp`
- **THEN** the response SHALL be `405`
- **AND** it SHALL NOT be the SPA HTML document served by the not-found handler

#### Scenario: Modern era ignores the session id header
- **WHEN** a request declaring `2026-07-28` carries an `Mcp-Session-Id` header
- **THEN** the server SHALL ignore it
- **AND** the server SHALL NOT mint a session id
- **AND** the response SHALL NOT carry an `Mcp-Session-Id` header

#### Scenario: Resume header is ignored
- **WHEN** a request carries a `Last-Event-ID` header
- **THEN** the server SHALL ignore it
- **AND** the server SHALL NOT attempt to resume a prior stream

#### Scenario: Modern request without a prior handshake succeeds
- **WHEN** a `tools/call` request declaring `2026-07-28` is the first request a client has ever sent
- **AND** it carries `io.modelcontextprotocol/protocolVersion` in `params._meta`
- **THEN** the server SHALL execute the call without requiring `initialize`

#### Scenario: Modern era refuses the handshake
- **WHEN** a request declaring `2026-07-28` (for `initialize`: in `params.protocolVersion`) calls `initialize`, `ping`, or any `notifications/*` method
- **THEN** the server SHALL respond `404` with JSON-RPC error `-32601`

#### Scenario: Legacy initialize handshake is answered
- **WHEN** a client sends `initialize` with `params.protocolVersion` of `2025-03-26`, `2025-06-18` or `2025-11-25`
- **AND** the request is authenticated
- **THEN** the server SHALL respond with `protocolVersion` equal to the requested revision, `capabilities` of exactly `{ "tools": { "listChanged": false } }`, and `serverInfo`
- **AND** the response SHALL carry an `Mcp-Session-Id` header

#### Scenario: Initialize with an unknown version negotiates down
- **WHEN** a client sends `initialize` with a `params.protocolVersion` the server does not serve (other than `2026-07-28`)
- **THEN** the server SHALL respond with a successful `InitializeResult` whose `protocolVersion` is `2025-11-25`
- **AND** the server SHALL NOT return a JSON-RPC error

#### Scenario: Initialize without a protocol version is refused
- **WHEN** a client sends `initialize` without a string `params.protocolVersion`
- **THEN** the server SHALL return `UnsupportedProtocolVersionError`
- **AND** the error message SHALL name all four supported revisions

#### Scenario: Discover lists every served revision
- **WHEN** a client calls the `server/discover` tool
- **THEN** the response SHALL list `2025-03-26`, `2025-06-18`, `2025-11-25` and `2026-07-28`

#### Scenario: Legacy notifications are accepted
- **WHEN** a legacy client sends `notifications/initialized`, `notifications/cancelled`, or any other `notifications/*` method, with or without an `id`
- **THEN** the server SHALL respond `202 Accepted` with no body
- **AND** the server SHALL NOT act on the notification

#### Scenario: Legacy ping is answered
- **WHEN** a legacy client sends `ping`
- **THEN** the server SHALL respond with an empty result object

#### Scenario: Legacy tools calls work after the handshake
- **WHEN** a legacy client sends `tools/list` or `tools/call` with an `MCP-Protocol-Version` header of `2025-03-26`, `2025-06-18` or `2025-11-25` and no `io.modelcontextprotocol/protocolVersion` in `params._meta`
- **THEN** the server SHALL dispatch the call through the same guarded allowlist as the modern era
- **AND** the result SHALL be identical to the modern-era result for the same tool and arguments

#### Scenario: Legacy request without a handshake still works
- **WHEN** a legacy client sends `tools/call` with an `MCP-Protocol-Version: 2025-06-18` header without ever having called `initialize`
- **THEN** the server SHALL dispatch the call
- **AND** the server SHALL NOT require a prior `Mcp-Session-Id`

#### Scenario: Legacy request with unknown session id still works
- **WHEN** a legacy request carries an `Mcp-Session-Id` the server did not mint (for example after a server restart)
- **THEN** the server SHALL dispatch the call
- **AND** the server SHALL NOT respond `404` for the session id

#### Scenario: Request with no version marker defaults to legacy
- **WHEN** a non-`initialize` `POST /mcp` request carries no `MCP-Protocol-Version` header
- **AND** `params._meta` is absent or lacks the `io.modelcontextprotocol/protocolVersion` key
- **THEN** the server SHALL treat the request as legacy revision `2025-03-26`
- **AND** the server SHALL NOT treat it as `2026-07-28`

#### Scenario: Legacy request with non-version _meta still defaults to legacy
- **WHEN** a request carries no `MCP-Protocol-Version` header
- **AND** `params._meta` is present with only other keys (for example `progressToken`)
- **THEN** the server SHALL treat the request as legacy revision `2025-03-26`

#### Scenario: Ambiguous version header is refused
- **WHEN** any `POST /mcp` request, including `initialize`, carries more than one `MCP-Protocol-Version` header
- **THEN** the server SHALL respond `400` with an ambiguous-header error
- **AND** the server SHALL NOT default to a legacy revision
- **AND** the server SHALL NOT answer the handshake

#### Scenario: Modern era requires the header
- **WHEN** a request declares `2026-07-28` in `params._meta` but carries no `MCP-Protocol-Version` header
- **THEN** the server SHALL refuse the request

#### Scenario: Modern era requires the body version
- **WHEN** a request carries an `MCP-Protocol-Version: 2026-07-28` header but `params._meta` lacks the version key
- **THEN** the server SHALL refuse the request
- **AND** the server SHALL NOT silently default to its latest supported version

#### Scenario: Header and body version mismatch is refused
- **WHEN** the `MCP-Protocol-Version` header disagrees with the
  `io.modelcontextprotocol/protocolVersion` value in `params._meta`
- **THEN** the server SHALL respond `400` with a `HeaderMismatch` error

#### Scenario: Unsupported protocol version is refused
- **WHEN** a non-`initialize` request declares a protocol version other than `2025-03-26`, `2025-06-18`, `2025-11-25`, or `2026-07-28`
- **THEN** the server SHALL return `UnsupportedProtocolVersionError`

#### Scenario: Unknown method returns 404 with JSON-RPC -32601
- **WHEN** a request names a method the server does not implement
- **THEN** the server SHALL respond `404`
- **AND** the body SHALL carry JSON-RPC error code `-32601`

#### Scenario: Malformed payloads produce JSON-RPC errors, never a 500
- **WHEN** a request body is not valid JSON, or is valid JSON that is not JSON-RPC
- **THEN** the server SHALL return a JSON-RPC parse or invalid-request error
- **AND** the server SHALL NOT return `500`
- **AND** the server SHALL NOT raise an unhandled rejection

#### Scenario: Oversized and deeply nested payloads are bounded
- **WHEN** a request body exceeds the configured size limit, or is deeply nested
- **THEN** the server SHALL reject it within a bounded amount of work
- **AND** the server SHALL NOT grow memory without bound or overflow the stack

### Requirement: Legacy-era requests are authenticated identically
The legacy handshake SHALL NOT weaken authentication. Every legacy-era request,
including `initialize`, `ping` and `notifications/*`, SHALL present a valid
bearer; an `Mcp-Session-Id` SHALL never substitute for the credential.

#### Scenario: Unauthenticated initialize is refused
- **WHEN** an `initialize` request arrives with no `Authorization` header or an invalid bearer
- **THEN** the server SHALL respond `401`
- **AND** the server SHALL NOT mint an `Mcp-Session-Id`

#### Scenario: Session id does not carry authentication
- **WHEN** a legacy request carries a previously minted `Mcp-Session-Id` but no `Authorization` header
- **THEN** the server SHALL respond `401`

### Requirement: Session listing is bounded, filterable and cursor-paged
The session-listing tool SHALL accept optional filter arguments, an optional
result limit and an optional opaque cursor. It SHALL apply a server-side default
limit when none is given, and SHALL enforce a hard maximum that a caller cannot
raise. An unbounded full-store response SHALL NOT be reachable.

Every response SHALL indicate whether more results exist, so a caller can
distinguish an exhausted list from a truncated page.

#### Scenario: Default call is bounded
- **WHEN** the listing tool is invoked with no arguments against a store holding more sessions than the default limit
- **THEN** the result SHALL contain at most the default number of sessions
- **AND** it SHALL indicate that more results exist

#### Scenario: Caller cannot exceed the hard maximum
- **WHEN** a caller requests a limit above the hard maximum
- **THEN** the server SHALL reject the call with an invalid-params error
- **AND** it SHALL NOT return a result page

#### Scenario: Exhausted list is distinguishable from a truncated page
- **WHEN** the final page is returned
- **THEN** the response SHALL indicate that no further results exist
- **AND** it SHALL NOT carry a continuation cursor

#### Scenario: Cursor walks the list without gaps or repeats
- **WHEN** a caller pages through the whole store using returned cursors
- **THEN** every session present for the whole walk SHALL appear exactly once

#### Scenario: Sessions sharing a sort timestamp still walk exactly once
- **WHEN** two or more sessions share the same ordering timestamp and the walk crosses the page boundary between them
- **THEN** each of those sessions SHALL appear exactly once across the walk

#### Scenario: A session created or ended mid-walk does not corrupt the walk
- **WHEN** a session is created or transitions to ended between two pages of a walk
- **THEN** no unrelated session SHALL be duplicated or skipped

#### Scenario: A session removed mid-walk does not corrupt the walk
- **WHEN** a session is removed from the store between two pages of a walk
- **THEN** the walk SHALL continue from the cursor position
- **AND** no unrelated session SHALL be duplicated or skipped

#### Scenario: Filters narrow the result set
- **WHEN** a caller supplies a status filter
- **THEN** only sessions matching that status SHALL be returned
- **AND** the reported match count SHALL reflect the filter, not the whole store

#### Scenario: Status filter accepts multiple values
- **WHEN** a caller supplies several status values in one call
- **THEN** sessions matching any of the supplied values SHALL be returned

#### Scenario: Hidden sessions are excluded by default
- **WHEN** the store contains sessions marked hidden
- **THEN** a default listing SHALL NOT include them
- **AND** the reported match count SHALL NOT count them

#### Scenario: A malformed argument is reported, not coerced
- **WHEN** a caller supplies a limit that is not a number, or a filter value outside the accepted set
- **THEN** the server SHALL return an invalid-params error
- **AND** it SHALL NOT silently substitute a default

#### Scenario: A numeric string is rejected rather than coerced
- **WHEN** a caller supplies a limit as a string containing digits
- **THEN** the server SHALL return an invalid-params error

#### Scenario: A zero or negative limit is rejected
- **WHEN** a caller supplies a limit of zero or a negative number
- **THEN** the server SHALL return an invalid-params error
- **AND** it SHALL NOT fall back to the default limit

#### Scenario: An unknown argument is rejected
- **WHEN** a caller supplies an argument name the tool does not declare
- **THEN** the server SHALL return an invalid-params error
- **AND** it SHALL NOT return a result computed as though the argument were absent

#### Scenario: A malformed cursor is rejected
- **WHEN** a caller supplies a cursor that cannot be decoded
- **THEN** the server SHALL return an invalid-params error

#### Scenario: A cursor presented with different filters is rejected
- **WHEN** a caller supplies a cursor together with filter or limit arguments differing from those that produced it
- **THEN** the server SHALL return an invalid-params error
- **AND** it SHALL NOT return a page from a different result set

#### Scenario: Validation of other tools is unchanged
- **WHEN** any other tool in the allowlist is invoked with arguments that were valid before this change
- **THEN** the call SHALL still be accepted and dispatched

#### Scenario: The advertised schema documents the bound
- **WHEN** a client reads the tool's advertised input schema and description
- **THEN** the default limit, the hard maximum and the paging argument SHALL be discoverable there
