# bearer-device-auth Specification

## Purpose
Authenticate paired devices with long-lived opaque bearer tokens held in a server-side revocable registry, feeding the existing authentication decision for REST and WebSocket without altering the loopback, trusted-network, or cookie paths.

## Requirements

### Requirement: Long-lived opaque bearer tokens in a revocable registry
A long-lived opaque bearer token SHALL be recorded in a server-side
paired-devices registry (`~/.pi/dashboard/paired-devices.json`, `0600`) with
device label, created-at, last-seen, an issuance `source`, and a `tier` from
`observe | control | operate`. Tokens SHALL be issued by one of two paths:
redeeming a pairing code (`source: "pairing"`) or direct issuance by an
authenticated operator (`source: "manual"`). Both paths SHALL accept a tier;
when omitted, `pairing` SHALL default to `operate` (a paired browser drives
the whole dashboard) and `manual` SHALL default to `observe`. Both paths
SHALL return the
plaintext token exactly once and store only a hash. The token SHALL be
revocable per device by deleting its registry entry regardless of source or
tier. The tier SHALL be fixed at issuance; changing a device's tier SHALL
require revoking it and issuing a new token. Registry rows written before
`source` existed SHALL read as `"pairing"`; rows written before `tier` existed
SHALL read as `"operate"` (the access they were issued with). Rewriting the
registry SHALL preserve fields it does not understand.

#### Scenario: Token issued and recorded
- **WHEN** a device successfully redeems a pairing code
- **THEN** an opaque bearer token is returned and a registry entry with `source: "pairing"` and the chosen tier is created for the device

#### Scenario: Manual issuance defaults to observe
- **WHEN** a token is issued through direct issuance without an explicit tier
- **THEN** the registry entry SHALL carry `tier: "observe"`

#### Scenario: Pairing issuance defaults to operate
- **WHEN** a pairing code is redeemed without an explicit tier from the approver
- **THEN** the registry entry SHALL carry `tier: "operate"`

#### Scenario: Invalid tier rejected
- **WHEN** a token is requested with a tier outside `observe | control | operate`
- **THEN** the request SHALL be rejected and no registry entry SHALL be created

#### Scenario: Device revoked
- **WHEN** a user revokes a device from Settings
- **THEN** its registry entry is deleted and subsequent requests bearing that token are rejected

#### Scenario: Legacy row without source
- **WHEN** the registry file contains a row that has no `source` field
- **THEN** the row SHALL be listed with `source: "pairing"`
- **AND** its token SHALL continue to verify

#### Scenario: Legacy row without tier
- **WHEN** the registry file contains a row that has no `tier` field
- **THEN** the row SHALL be listed with `tier: "operate"`
- **AND** its token SHALL continue to verify

#### Scenario: Unknown fields survive a rewrite
- **WHEN** the registry file contains a row with a field the loader does not know
- **AND** another row is added or revoked
- **THEN** the unknown field SHALL still be present in the rewritten file

#### Scenario: Tier visible in the device list
- **WHEN** paired devices are listed
- **THEN** each row SHALL include its `tier`

### Requirement: Bearer auth branch for REST
The server SHALL accept a valid bearer token via `Authorization: Bearer` as an
authentication source feeding the existing `request.isAuthenticated` decision,
WITHOUT altering the loopback, trusted-network, or cookie paths. The durable
bearer token authenticates REST only; WebSocket upgrades authenticate via a
short-lived single-use ticket (see "WebSocket auth via single-use ticket before
upgrade") and the durable bearer SHALL NOT ride the socket.

#### Scenario: REST request authorized by bearer
- **WHEN** a cross-origin REST request presents a valid bearer token
- **THEN** the request is marked authenticated and served

#### Scenario: WebSocket authorized via ticket, not durable bearer
- **WHEN** a client needs a WebSocket to a paired server
- **THEN** it mints a single-use ticket from an authenticated REST call and presents that ticket on the upgrade, never the durable bearer token

#### Scenario: Existing paths unaffected
- **WHEN** a user relies only on loopback or the OAuth cookie
- **THEN** authentication behaves exactly as before this change

#### Scenario: Invalid bearer rejected
- **WHEN** a request presents an unknown or revoked bearer token and matches no other allow path
- **THEN** the server responds 401

### Requirement: Genuine-local trust via IPC allowlist, not a network address check
Auth exemption for local tooling SHALL be granted by an allowlist of genuine local
IPC — a dedicated Unix domain socket, or an explicit local token — NOT by matching
the TCP loopback address. The TCP loopback address SHALL NOT be auth-exempt for
any connection reachable through a listener or reverse proxy. This SHALL be
enforced at every call site (network guard, `onRequest` hook, and the WebSocket
upgrade handler).

#### Scenario: Tunnel request is not auto-trusted
- **WHEN** a request reaches the server via a tunnel/reverse proxy (presenting as `127.0.0.1`) with no valid bearer/cookie
- **THEN** the server SHALL NOT auth-exempt it and SHALL respond 401

#### Scenario: Unmarked tunnel is not auto-trusted
- **WHEN** a request arrives over a tunnel that injects no proxy marker (e.g. an SSH reverse tunnel)
- **THEN** the server SHALL still require a credential, because trust is not derived from the loopback address

#### Scenario: Genuine local IPC still bypasses
- **WHEN** a local tool connects over the dedicated Unix domain socket (or presents the local token)
- **THEN** the auth exemption SHALL apply

#### Scenario: Local IPC is not exposed to other host users
- **WHEN** the Unix socket is created or the local token is written
- **THEN** the socket path SHALL be `0600` and the token SHALL live in a `0700` directory so other users on a shared host cannot use it

#### Scenario: Existing same-host callers migrated, not broken
- **WHEN** D10 lands
- **THEN** the pi bridge, terminal, editor, and model-proxy SHALL already connect via the local IPC allowlist (Unix socket / local token), not via bare TCP-loopback trust

### Requirement: WebSocket auth via single-use ticket before upgrade
A client SHALL obtain a short-lived, single-use WebSocket ticket from an
authenticated REST endpoint and present it when opening the socket. The server
SHALL refuse the upgrade unless the ticket validates, so no authenticated socket
exists before authentication (no TOCTOU). `Origin` validation against the CORS
allow-list SHALL be applied as defense-in-depth but SHALL NOT be the sole gate,
since absent-`Origin` requests exist. The durable bearer token SHALL NOT be placed
in the WebSocket URL, header, or logs; only the ephemeral ticket may ride the URL.

Once the upgrade is authorized (valid ticket, genuine-local origin, local-IPC
token, or trusted network), the server SHALL complete the upgrade by routing the
request to the correct WebSocket gateway based on the URL **path only**, ignoring
any query string. A ticket carried in the query (`/ws?ticket=<t>`) SHALL route
identically to a bare-path request (`/ws`); the presence of the ticket query
SHALL NOT cause the authorized socket to be destroyed instead of upgraded.

#### Scenario: No ticket, no upgrade
- **WHEN** a WebSocket upgrade is attempted without a valid single-use ticket
- **THEN** the server SHALL refuse the upgrade and no data SHALL be sent on the socket

#### Scenario: Ticket is single-use and short-lived
- **WHEN** a ticket is reused or presented after its short TTL
- **THEN** the upgrade SHALL be refused (ticket held in server memory, deleted synchronously on first upgrade attempt)

#### Scenario: Ticket bound to route scope
- **WHEN** a ticket minted for one WS route is presented against a different, more-privileged route (e.g. `/ws/terminal/*`)
- **THEN** the upgrade SHALL be refused

#### Scenario: No authenticated socket before auth
- **WHEN** a client opens a socket and withholds any further frames
- **THEN** because the ticket was validated at upgrade time, an unauthenticated socket is never admitted to receive broadcasts

#### Scenario: Validated ticketed upgrade completes on the browser route
- **WHEN** a client opens `/ws?ticket=<valid browser-scope ticket>` and the ticket validates
- **THEN** the server SHALL route the upgrade to the browser gateway and return `101 Switching Protocols`
- **AND** the server SHALL NOT destroy the socket merely because the URL carried a `?ticket=` query string

#### Scenario: Query string does not defeat path routing (no-auth branch)
- **WHEN** no OAuth secret is configured and a genuine-local or ticket-authorized client opens `/ws?ticket=<t>`
- **THEN** routing SHALL be decided on the path `/ws` (query stripped) and the upgrade SHALL complete, not fall through to a destroyed socket

### Requirement: Direct token issuance for a local operator
The server SHALL expose `POST /api/paired-devices` accepting `{ label }` and
returning the standard response envelope `{ success: true, data: { device,
token } }` where `token` is the plaintext bearer, returned once and never
retrievable again. The route SHALL accept only an **operator** credential:
an authenticated dashboard login session (cookie), a valid `X-Pi-Local-Token`,
or a genuinely local (loopback, non-forwarded) caller in any authentication
mode. A paired-device bearer or a trusted-network address
alone SHALL NOT authorise minting. The route SHALL additionally refuse any
request whose `Host` header is not an admitted dashboard host, irrespective of
the global Host-admission gate mode. It SHALL NOT be a public pairing prefix.
The minted token SHALL be indistinguishable from a pairing-minted token to
every consumer (REST bearer branch, `/mcp` device caller resolution).

#### Scenario: Operator mints a token
- **WHEN** an operator-authenticated request on an admitted host posts `{ "label": "claude-code" }`
- **THEN** the server SHALL respond `200` with the plaintext token and a device view carrying `source: "manual"`
- **AND** a subsequent `GET /api/paired-devices` SHALL list the row without the token

#### Scenario: A paired device cannot clone itself
- **WHEN** a request authenticated only by a paired-device bearer posts to `/api/paired-devices`
- **THEN** the server SHALL respond `401`
- **AND** no registry row SHALL be created

#### Scenario: Trusted network alone cannot mint
- **WHEN** authentication is disabled and a request from a configured trusted network, but not loopback, posts to `/api/paired-devices` with no credential
- **THEN** the server SHALL respond `401`
- **AND** no registry row SHALL be created

#### Scenario: Local browser mints with authentication enabled
- **WHEN** authentication is enabled and a loopback, non-forwarded request with no cookie posts a valid label
- **THEN** the server SHALL respond `200` with a token

#### Scenario: Label is required
- **WHEN** the body omits `label`, or `label` is not a string, or is empty after trimming, or exceeds 64 bytes of UTF-8
- **THEN** the server SHALL respond `400`
- **AND** no registry row SHALL be created

#### Scenario: Unadmitted host cannot mint even when the global gate only reports
- **WHEN** the Host-admission gate is in `report` mode
- **AND** an otherwise-authorised request posts to `/api/paired-devices` with a `Host` header the dashboard does not admit
- **THEN** the server SHALL respond `403`
- **AND** no registry row SHALL be created

#### Scenario: Unauthenticated mint is refused
- **WHEN** a request that fails the auth / network-guard decision posts to `/api/paired-devices`
- **THEN** the server SHALL respond `401`
- **AND** no registry row SHALL be created

#### Scenario: Minted token reaches /mcp
- **WHEN** a client presents a manually minted token as `Authorization: Bearer` on `POST /mcp`
- **THEN** the request SHALL authenticate as a device caller with no originating session

#### Scenario: Manual rows are visible and revocable in Settings
- **WHEN** the Paired Devices list renders a `source: "manual"` row
- **THEN** it SHALL be visually marked as manually issued
- **AND** its revoke action SHALL behave as for pairing rows

### Requirement: Settings offers an MCP-client token flow
The Paired Devices settings section SHALL offer a "Create token for an MCP
client" action that collects a label, a tier (default `observe`) and a base
URL chosen from the dashboard's currently reachable URLs, calls the direct
issuance route, shows the plaintext token once, and renders a copyable client
configuration snippet targeting `/mcp` on the chosen base URL.

#### Scenario: Snippet is copy-ready
- **WHEN** the operator completes the create-token flow
- **THEN** the UI SHALL show the token once with a copy control
- **AND** the UI SHALL show a `claude mcp add --transport http … /mcp --header "Authorization: Bearer <token>"` line using the same token and the chosen base URL

#### Scenario: Base URL choices reflect reachability
- **WHEN** the create-token flow opens
- **THEN** the base-URL choices SHALL be the dashboard's reachable URLs (loopback, LAN IPv4, configured public URLs, tunnel when active)
- **AND** the browser's own origin SHALL be preselected when it is among them

#### Scenario: Tier is explained before minting
- **WHEN** the operator selects a tier
- **THEN** the UI SHALL show a one-line description of what that tier can do
- **AND** `operate` SHALL be marked as granting restart, package and process control

#### Scenario: Token is not shown again
- **WHEN** the operator dismisses the create-token result
- **THEN** the plaintext token SHALL NOT be retrievable from the UI or any API

### Requirement: A device bearer's tier gates REST routes and WS-ticket minting
Every `/api/*` route SHALL have a tier from a single route→tier map in
`packages/shared`; a route absent from the map SHALL require `operate`. A
request admitted via a paired-device bearer SHALL be refused with HTTP 403,
`WWW-Authenticate: Bearer error="insufficient_scope" scope="<tier>"` and a
logged refusal when the route's tier exceeds the row's tier. `/api/ws-ticket`
SHALL require `operate`. Principals admitted by other means (browser cookie
session, local token) SHALL see no change, and a bearer presented from a
genuinely local or trusted-network address SHALL NOT be tier-refused (that
network position is already fully trusted). The gate SHALL only refuse; it
SHALL NOT admit a request that existing admission rules reject.

#### Scenario: Observe bearer cannot restart
- **WHEN** a request bearing an `observe` device token calls `POST /api/restart`
- **THEN** the server SHALL respond 403 with `WWW-Authenticate` containing `error="insufficient_scope"` and `scope="operate"`
- **AND** the restart handler SHALL NOT run

#### Scenario: Control bearer cannot mint a WS ticket
- **WHEN** a request bearing a `control` device token calls `POST /api/ws-ticket`
- **THEN** the server SHALL respond 403 with `scope="operate"`

#### Scenario: Observe bearer reads within tier
- **WHEN** a request bearing an `observe` device token calls `GET /api/sessions`
- **THEN** the request SHALL be served

#### Scenario: Browser principal unchanged
- **WHEN** a request is admitted by a browser cookie session or the local token
- **THEN** no route SHALL be refused on tier grounds

#### Scenario: Loopback bearer is not tier-refused
- **WHEN** a request from a genuinely local address bears an `observe` device token and calls `POST /api/restart`
- **THEN** the request SHALL NOT be refused on tier grounds

#### Scenario: Unlisted route fails closed
- **WHEN** a route with no entry in the route→tier map is called with a `control` bearer
- **THEN** the server SHALL respond 403 with `scope="operate"`

#### Scenario: Refusal is logged
- **WHEN** a tier refusal occurs
- **THEN** a log line SHALL record the device id, method, route pattern, principal tier and required tier

### Requirement: Headless token issuance from the CLI
The `pi-dashboard` CLI SHALL offer `token create --label <label> [--tier
<tier>] [--url <base>]` that mints a paired-device token through the direct
issuance route using the local token, and prints the token once together with
one client configuration snippet per reachable URL (or one snippet for
`--url`). It SHALL fail when the dashboard is not running or the local token
is unavailable.

#### Scenario: Operator mints from the CLI
- **WHEN** `pi-dashboard token create --label ci-agent --tier control` runs on the dashboard host
- **THEN** a `manual` registry row with `tier: "control"` SHALL be created
- **AND** stdout SHALL contain the plaintext token exactly once and one `claude mcp add` line per reachable URL

#### Scenario: CLI refuses without a running dashboard
- **WHEN** `pi-dashboard token create` runs and the dashboard is not reachable
- **THEN** the command SHALL exit non-zero without creating a row

#### Scenario: Explicit base URL overrides
- **WHEN** `--url https://x.share.zrok.io` is passed
- **THEN** the printed snippet SHALL target `https://x.share.zrok.io/mcp`
