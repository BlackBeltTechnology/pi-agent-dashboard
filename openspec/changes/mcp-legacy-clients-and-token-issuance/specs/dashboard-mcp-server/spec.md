## REMOVED Requirements

### Requirement: Stateless MCP endpoint conforming to revision 2026-07-28
**Reason**: `/mcp` now serves two protocol eras over one route; the single-revision contract (and its scenarios refusing `initialize`, `Mcp-Session-Id`, and every other revision) is superseded by "Dual-era MCP endpoint" below.
**Migration**: `2026-07-28` callers are unaffected — every modern-era scenario is carried over verbatim into the new requirement. `pi-mcp-adapter` provisioning stays pinned to `2026-07-28`.

## ADDED Requirements

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

## MODIFIED Requirements

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
