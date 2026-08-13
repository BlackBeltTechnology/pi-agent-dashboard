## ADDED Requirements

### Requirement: Stateless MCP endpoint conforming to revision 2026-07-28
The dashboard SHALL expose a single MCP endpoint at `POST /mcp` implementing
protocol revision `2026-07-28`. The endpoint SHALL be stateless at the protocol
layer: it SHALL NOT mint, echo, or honour session identifiers, and it SHALL NOT
require an `initialize` handshake. No request SHALL depend on state established
by a previous request. A `subscriptions/listen` stream is scoped to its own
request and does not constitute cross-request state.

#### Scenario: GET and DELETE are rejected with 405
- **WHEN** an HTTP `GET` or `DELETE` is issued to `/mcp`
- **THEN** the server SHALL respond `405 Method Not Allowed`

#### Scenario: 405 holds in development mode
- **WHEN** the server runs in `--dev` mode with the Vite proxy active
- **AND** an HTTP `GET` is issued to `/mcp`
- **THEN** the response SHALL be `405`
- **AND** it SHALL NOT be the SPA HTML document served by the not-found handler

#### Scenario: Session id header is ignored
- **WHEN** a request carries an `Mcp-Session-Id` header
- **THEN** the server SHALL ignore it
- **AND** the server SHALL NOT mint a session id
- **AND** the response SHALL NOT carry an `Mcp-Session-Id` header

#### Scenario: Resume header is ignored
- **WHEN** a request carries a `Last-Event-ID` header
- **THEN** the server SHALL ignore it
- **AND** the server SHALL NOT attempt to resume a prior stream

#### Scenario: Request without a prior handshake succeeds
- **WHEN** a `tools/call` request is the first request a client has ever sent
- **AND** it carries `io.modelcontextprotocol/protocolVersion` in `params._meta`
- **THEN** the server SHALL execute the call without requiring `initialize`

#### Scenario: Unsupported protocol version is refused
- **WHEN** a request declares a protocol version the server does not support
- **THEN** the server SHALL return `UnsupportedProtocolVersionError`

#### Scenario: Only revision 2026-07-28 is served
- **WHEN** a request declares `2025-06-18` or `2025-11-25`
- **THEN** the server SHALL return `UnsupportedProtocolVersionError`
- **AND** the server SHALL NOT fall back to a legacy handshake

#### Scenario: MCP-Protocol-Version header is required on every POST
- **WHEN** a `POST /mcp` request carries no `MCP-Protocol-Version` header
- **THEN** the server SHALL refuse the request
- **AND** the server SHALL NOT default to its latest supported version

#### Scenario: Header and body version mismatch is refused
- **WHEN** the `MCP-Protocol-Version` header disagrees with the
  `io.modelcontextprotocol/protocolVersion` value in `params._meta`
- **THEN** the server SHALL respond `400` with a `HeaderMismatch` error

#### Scenario: Absent params._meta version is refused
- **WHEN** a request omits `params._meta` entirely
- **THEN** the server SHALL refuse the request
- **AND** the server SHALL NOT silently default to its latest supported version

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
The dashboard SHALL provision its own entry into `~/.pi/agent/mcp.json` so a
local pi session can reach the endpoint. The entry SHALL declare a protocol
version selection that negotiates or pins the modern era rather than relying on
the adapter's legacy default.

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
- **WHEN** `mcpServers` already holds an entry under `pi-dashboard` that does not declare a `url`
- **THEN** the writer SHALL refuse the write and surface an error
- **AND** the existing file SHALL be left unmodified

#### Scenario: An existing dashboard entry is refreshed
- **WHEN** `mcpServers` already holds an entry under `pi-dashboard` that declares a `url`
- **THEN** the writer SHALL overwrite that entry

#### Scenario: Sibling entries are preserved
- **WHEN** the write occurs and the file already contains other `mcpServers` entries
- **THEN** every sibling entry SHALL be preserved unchanged

#### Scenario: Write is atomic
- **WHEN** the write occurs
- **THEN** it SHALL be performed via a temporary file and rename
- **AND** a partially-written file SHALL never be observable

#### Scenario: Unparseable config is refused, not repaired
- **WHEN** the existing file is present but not valid JSON
- **THEN** the write SHALL be refused and surfaced
- **AND** the existing file SHALL be left unmodified

#### Scenario: Server name does not collide
- **WHEN** the entry is written
- **THEN** its server name SHALL NOT be one already owned by another provisioner

### Requirement: Endpoint naming avoids collision with the pi MCP adapter
Dashboard surfaces added by this change SHALL NOT claim names owned by
`pi-mcp-adapter`.

#### Scenario: Command palette entry does not shadow the adapter
- **WHEN** the plugin declares a `command-route` claim
- **THEN** the claimed command SHALL NOT be `/mcp`

#### Scenario: No OAuth callback port is bound
- **WHEN** the MCP endpoint starts
- **THEN** it SHALL NOT bind an OAuth callback port
