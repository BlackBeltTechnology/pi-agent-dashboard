# bearer-device-auth Specification

## Purpose
Authenticate paired devices with long-lived opaque bearer tokens held in a server-side revocable registry, feeding the existing authentication decision for REST and WebSocket without altering the loopback, trusted-network, or cookie paths.
## Requirements
### Requirement: Long-lived opaque bearer tokens in a revocable registry
Redeeming a pairing code SHALL create a long-lived opaque bearer token recorded in
a server-side paired-devices registry (`~/.pi/dashboard/paired-devices.json`,
`0600`) with device label, created-at, and last-seen. The token SHALL be
revocable per device by deleting its registry entry.

#### Scenario: Token issued and recorded
- **WHEN** a device successfully redeems a pairing code
- **THEN** an opaque bearer token is returned and a registry entry is created for the device

#### Scenario: Device revoked
- **WHEN** a user revokes a device from Settings
- **THEN** its registry entry is deleted and subsequent requests bearing that token are rejected

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

