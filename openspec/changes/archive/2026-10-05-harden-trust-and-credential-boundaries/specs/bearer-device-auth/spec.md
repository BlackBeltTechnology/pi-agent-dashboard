## MODIFIED Requirements

### Requirement: Bearer auth branch for REST
The server SHALL accept a valid bearer token via `Authorization: Bearer`, or via
the httpOnly `SameSite=Strict` device cookie a same-origin browser obtains by
exchanging its bearer (`POST /api/device-session`, cookie scoped to `path=/api/`), as an authentication source feeding the existing `request.isAuthenticated` decision,
WITHOUT altering the loopback, trusted-network, or OAuth cookie paths. A request
admitted by the device cookie SHALL carry the same `authVia = "device"` marker
and tier as the bearer, and revoking the device SHALL invalidate both. The durable
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
- **WHEN** `requireLocalProof` is disabled and a user relies only on loopback or the OAuth cookie
- **THEN** authentication behaves exactly as before this change

#### Scenario: Invalid bearer rejected
- **WHEN** a request presents an unknown or revoked bearer token and matches no other allow path
- **THEN** the server responds 401

#### Scenario: Device cookie authenticates like the bearer

- **WHEN** a same-origin browser presents a valid device cookie and no `Authorization` header
- **THEN** the request is marked authenticated with `authVia = "device"` and the device's tier

#### Scenario: Revoked device cookie rejected

- **WHEN** a request presents the device cookie of a revoked device and matches no other allow path
- **THEN** the server responds 401

### Requirement: Genuine-local trust via IPC allowlist, not a network address check
Auth exemption for local tooling SHALL be granted by an allowlist of genuine local
IPC — a dedicated Unix domain socket, or an explicit local token — or by a
genuinely-local TCP request: loopback peer AND no proxy-forwarding header
(`x-forwarded-*`, `x-real-ip`, `forwarded`). A loopback request carrying a
forwarding header SHALL NOT be auth-exempt. A marker-less reverse tunnel
terminating on loopback is indistinguishable from a genuinely-local request at
the socket level; it is closed only when `auth.requireLocalProof` is enabled, in
which case a bare genuinely-local request SHALL be exempt only for
`observe`-tier routes, and `control`/`operate` routes plus browser WebSocket
upgrades SHALL additionally require the local token, a local-proof cookie, or
another credential. This SHALL be enforced at every call site (network guard,
`onRequest` hook, and the WebSocket upgrade handlers) through one shared
predicate.

#### Scenario: Tunnel request is not auto-trusted
- **WHEN** a request reaches the server via a header-injecting tunnel/reverse proxy (presenting as `127.0.0.1` with an `x-forwarded-*`, `x-real-ip`, or `forwarded` header) with no valid bearer/cookie
- **THEN** the server SHALL NOT auth-exempt it and SHALL respond 401

#### Scenario: Unmarked tunnel is not auto-trusted
- **WHEN** `auth.requireLocalProof` is enabled and a request arrives over a tunnel that injects no proxy marker (e.g. an SSH reverse tunnel) for a `control`/`operate` route
- **THEN** the server SHALL still require a credential (local token, local-proof cookie, or other), because trust is not derived from the loopback address alone

#### Scenario: Unmarked tunnel under default configuration
- **WHEN** `auth.requireLocalProof` is not enabled and a request arrives over a tunnel that injects no proxy marker
- **THEN** it SHALL be treated as genuinely local, and operator documentation SHALL state that only header-injecting tunnels are safe without `requireLocalProof`

#### Scenario: Genuine local IPC still bypasses
- **WHEN** a local tool connects over the dedicated Unix domain socket (or presents the local token)
- **THEN** the auth exemption SHALL apply

#### Scenario: Local IPC is not exposed to other host users
- **WHEN** the Unix socket is created or the local token is written
- **THEN** the socket path SHALL be `0600` and the token SHALL live in a `0700` directory so other users on a shared host cannot use it

#### Scenario: Existing same-host callers migrated, not broken
- **WHEN** D10 lands
- **THEN** the pi bridge and model-proxy SHALL connect via the local IPC allowlist (Unix socket / local token); the same-desktop browser (terminal and editor views) SHALL be admitted as genuinely local, or via the local-proof cookie when `auth.requireLocalProof` is enabled

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


When `requireLocalProof` is enabled, the genuinely-local (loopback, non-forwarded) condition in this requirement is narrowed by the "Opt-in local proof for loopback trust" requirement of `trust-and-credential-boundaries`; with it disabled (the default) this requirement is unchanged.

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
- **WHEN** `requireLocalProof` is disabled and authentication is enabled and a loopback, non-forwarded request with no cookie posts a valid label
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

Revocation SHALL accept only an **operator** credential — the same admission
rule as direct token issuance: an authenticated dashboard login session, a
valid `X-Pi-Local-Token`, or a genuinely local (loopback, non-forwarded)
caller. A request authenticated only by a paired-device bearer SHALL NOT
revoke any registry row, including its own, regardless of the caller's network
position — a device bearer arriving over loopback SHALL be refused on the
strength of the credential alone.


When `requireLocalProof` is enabled, the genuinely-local (loopback, non-forwarded) condition in this requirement is narrowed by the "Opt-in local proof for loopback trust" requirement of `trust-and-credential-boundaries`; with it disabled (the default) this requirement is unchanged.

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

#### Scenario: Paired device cannot revoke a sibling
- **GIVEN** two paired devices A and B exist in the registry
- **WHEN** a request authenticated only by device A's bearer sends `DELETE /api/paired-devices/<id of B>`
- **THEN** the server SHALL respond `401`
- **AND** device B's registry row SHALL remain and its token SHALL continue to verify

#### Scenario: Paired device cannot revoke itself
- **WHEN** a request authenticated only by device A's bearer sends `DELETE /api/paired-devices/<id of A>`
- **THEN** the server SHALL respond `401` and device A's row SHALL remain

#### Scenario: Loopback device bearer cannot revoke
- **WHEN** a request authenticated only by device A's bearer sends `DELETE /api/paired-devices/<id of B>` from `127.0.0.1` with no forwarding headers
- **THEN** the server SHALL respond `401` and device B's row SHALL remain

#### Scenario: Operator revokes over a tunnel
- **WHEN** a request carrying an authenticated dashboard login session sends `DELETE /api/paired-devices/<id>` from a non-local address
- **THEN** the server SHALL revoke the row and respond `200`

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


When `requireLocalProof` is enabled, the genuinely-local (loopback, non-forwarded) condition in this requirement is narrowed by the "Opt-in local proof for loopback trust" requirement of `trust-and-credential-boundaries`; with it disabled (the default) this requirement is unchanged.

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
- **WHEN** `requireLocalProof` is disabled and a request from a genuinely local address bears an `observe` device token and calls `POST /api/restart`
- **THEN** the request SHALL NOT be refused on tier grounds

#### Scenario: Unlisted route fails closed
- **WHEN** a route with no entry in the route→tier map is called with a `control` bearer
- **THEN** the server SHALL respond 403 with `scope="operate"`

#### Scenario: Refusal is logged
- **WHEN** a tier refusal occurs
- **THEN** a log line SHALL record the device id, method, route pattern, principal tier and required tier
