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
plaintext token exactly once per issuance or rotation and store only a hash. A row issued with a browser-holder declaration SHALL carry an expiry and rotate as stated in "Browser-held device bearers expire and rotate"; every other row SHALL have no expiry. The token SHALL be
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

When `requireLocalProof` is in effect (the default: absent or `true`), the genuinely-local (loopback, non-forwarded) condition in this requirement is narrowed by the "Opt-in local proof for loopback trust" requirement of `trust-and-credential-boundaries`. Only with it explicitly `false` is this requirement unchanged; a scenario below that says `requireLocalProof` is disabled means it is explicitly `false`.

#### Scenario: Browser-declared row is the only expiring kind
- **WHEN** a pairing code is redeemed with a browser-holder declaration, and another with none
- **THEN** only the first row SHALL carry an expiry
- **AND** the second row's token SHALL NOT expire

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

#### Scenario: Plaintext returned once per issuance or rotation
- **WHEN** a bearer is issued or rotated
- **THEN** the plaintext SHALL appear only in that response and SHALL NOT be retrievable afterwards from the registry or any list route

#### Scenario: Operator revokes over a tunnel
- **WHEN** a request carrying an authenticated dashboard login session sends `DELETE /api/paired-devices/<id>` from a non-local address
- **THEN** the server SHALL revoke the row and respond `200`

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
Auth exemption for local tooling SHALL be granted by an allowlist of genuine
local IPC: a dedicated Unix domain socket, or an explicit local token or local
credential proof. A genuinely-local TCP request (loopback peer AND no
proxy-forwarding header such as `x-forwarded-*`, `x-real-ip` or `forwarded`)
SHALL also need local proof for `control`/`operate` routes and browser WebSocket
upgrades.

A loopback request carrying a forwarding header SHALL NOT be auth-exempt.

A marker-less relay terminating on loopback is indistinguishable from a
genuinely-local request at the socket level. Examples: an SSH reverse tunnel,
`socat`, or a local container/VM runtime forwarding to host loopback. Under the
default configuration (the top-level `requireLocalProof` absent or `true`), such
a relay is closed: a bare genuinely-local request SHALL be exempt only for
`observe`-tier routes. `control`/`operate` routes plus browser WebSocket
upgrades SHALL additionally require the local token, a local credential proof, a
local-proof cookie, or another credential. Only an explicit
`requireLocalProof: false` SHALL restore the bare-loopback exemption. This SHALL
be enforced at every call site (network guard, `onRequest` hook, and the
WebSocket upgrade handlers) through one shared predicate.

#### Scenario: Tunnel request is not auto-trusted
- **WHEN** a request reaches the server via a header-injecting tunnel/reverse proxy (presenting as `127.0.0.1` with an `x-forwarded-*`, `x-real-ip`, or `forwarded` header) with no valid bearer/cookie
- **THEN** the server SHALL NOT auth-exempt it and SHALL respond 401

#### Scenario: Unmarked tunnel is not auto-trusted
- **WHEN** `requireLocalProof` is absent or `true` and a request arrives over a relay that injects no proxy marker (e.g. an SSH reverse tunnel, or a container runtime forwarding to host loopback) for a `control`/`operate` route
- **THEN** the server SHALL still require a credential (local token, local credential proof, local-proof cookie, or other), because trust is not derived from the loopback address alone

#### Scenario: Unmarked tunnel under default configuration
- **WHEN** `requireLocalProof` is absent from the config and a request with no credential arrives over a relay that injects no proxy marker, for a `control`/`operate` route or a browser WebSocket upgrade
- **THEN** it SHALL NOT be treated as genuinely local; only an explicit `requireLocalProof: false` restores that, and operator documentation SHALL state that opting out re-exposes the dashboard to any local container or marker-less tunnel

#### Scenario: Genuine local IPC still bypasses
- **WHEN** a local tool connects over the dedicated Unix domain socket (or presents the local token or a valid local credential proof)
- **THEN** the auth exemption SHALL apply

#### Scenario: Local IPC is not exposed to other host users
- **WHEN** the Unix socket is created or the local token is written
- **THEN** the socket path SHALL be `0600` and the token SHALL live in a `0700` directory so other users on a shared host cannot use it

#### Scenario: Existing same-host callers migrated, not broken
- **WHEN** the default configuration is in effect
- **THEN** the pi bridge and model-proxy SHALL connect via the local IPC allowlist (Unix socket / local credential proof); the same-desktop browser (terminal and editor views) SHALL be admitted via the local-proof cookie obtained through `pi-dashboard open` or the desktop app

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

When `requireLocalProof` is in effect (the default: absent or `true`), the genuinely-local (loopback, non-forwarded) condition in this requirement is narrowed by the "Opt-in local proof for loopback trust" requirement of `trust-and-credential-boundaries`. Only with it explicitly `false` is this requirement unchanged; a scenario below that says `requireLocalProof` is disabled means it is explicitly `false`.

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
SHALL require `operate`. `POST /api/paired-devices/rotate` SHALL be entered in that map at tier `observe`, so any valid browser-held bearer, of any tier, may rotate itself; the route SHALL authenticate by that bearer and SHALL rotate only the device that bearer belongs to. Principals admitted by other means (browser cookie
session, local token) SHALL see no change. A bearer presented from a genuinely
local address SHALL NOT be tier-refused. A bearer presented from a
trusted-network address SHALL NOT be tier-refused **only when the effective
trust mode is `"legacy"`**; in `"pair"` mode a network match grants no tier
exemption. The gate SHALL only refuse; it SHALL NOT admit a request that
existing admission rules reject.

When `requireLocalProof` is in effect (the default: absent or `true`), the genuinely-local (loopback, non-forwarded) condition in this requirement is narrowed by the "Opt-in local proof for loopback trust" requirement of `trust-and-credential-boundaries`. Only with it explicitly `false` is this requirement unchanged; a scenario below that says `requireLocalProof` is disabled means it is explicitly `false`.

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

#### Scenario: Trusted-network bearer exempt only in legacy mode
- **GIVEN** `trustedNetworks: ["192.168.16.0/24"]`
- **WHEN** a request from `192.168.16.20` bears an `observe` device token and calls `POST /api/restart`
- **THEN** it SHALL NOT be tier-refused when the effective trust mode is `"legacy"`
- **AND** it SHALL be refused with 403 `scope="operate"` when the effective trust mode is `"pair"`

#### Scenario: Observe bearer may rotate itself
- **WHEN** a request bearing an unexpired `observe` browser bearer calls `POST /api/paired-devices/rotate`
- **THEN** the request SHALL NOT be refused on tier grounds
- **AND** the rotated bearer SHALL belong to the same device and carry tier `observe`

#### Scenario: Rotation never touches another device
- **WHEN** a bearer for device A calls `POST /api/paired-devices/rotate`, whatever its body
- **THEN** only device A's row SHALL be rotated and no other device's bearer SHALL change

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

### Requirement: Device cookie survives a plain-http LAN exchange
The device-session exchange (`POST /api/device-session`) SHALL NOT set the `Secure` attribute on the device cookie when the exchanging request is a direct plain-http connection from a peer outside the loopback range carrying no forwarding header (`X-Forwarded-*` or `Forwarded`) (socket not encrypted; peer not in `127.0.0.0/8`, `::1` or `::ffff:127.0.0.0/104`, the same range the relayed-loopback rule uses), regardless of any configured public `https` base. In every other case the existing rule SHALL apply: `Secure` when the resolved base is `https:` (so a TLS reverse proxy or tunnel that forwards plain http on the loopback hop still yields a `Secure` cookie), `Secure` whenever the request's own socket is TLS, and `Secure` when the request's socket peer is a loopback address and its `Host` names a live `https` tunnel origin — matched on host AND port in canonical form, with a non-`https` tunnel origin never qualifying, and judged on the socket peer, never on forwarding headers — exactly as the session cookie rule of `oauth-authentication` decides it. The cookie setter SHALL receive the request so it can make this decision. This governs the device cookie (`pi_dash_device`); the session cookie follows the same tunnel rule through `oauth-authentication`.

#### Scenario: http LAN exchange on an https-configured install
- **GIVEN** the dashboard's resolved base is `https://pi-robson.share.zrok.io`
- **WHEN** a browser at `192.168.16.31` exchanges a valid bearer at `http://192.168.16.204:8000/api/device-session`
- **THEN** the `Set-Cookie` for the device cookie SHALL NOT carry `Secure`
- **AND** the browser's next `/api/` request SHALL be authenticated by that cookie

#### Scenario: Forwarding headers disable the LAN carve-out
- **GIVEN** the dashboard's resolved base is `https://pi-robson.share.zrok.io`
- **WHEN** a plain-http exchange from a non-loopback peer carries `X-Forwarded-For` or another forwarding header
- **THEN** the carve-out SHALL NOT apply and the existing rule SHALL decide the `Secure` attribute (here `Secure`, because the resolved base is `https:`)

#### Scenario: TLS exchange keeps Secure
- **WHEN** a browser exchanges a valid bearer over an https connection
- **THEN** the device cookie SHALL carry `Secure`

#### Scenario: Tunnel exchange keeps Secure
- **GIVEN** the resolved base is `https://pi-robson.share.zrok.io`
- **WHEN** a browser exchanges a valid bearer through the tunnel, arriving as plain http from peer `127.0.0.1` with `X-Forwarded-Proto: https`
- **THEN** the device cookie SHALL carry `Secure`

#### Scenario: Header-injecting tunnel keeps Secure by socket peer
- **GIVEN** the resolved base is a plain `http:` origin and a live https tunnel origin is `https://pi.share.example`
- **WHEN** a browser exchanges a valid bearer through a tunnel that adds `X-Forwarded-For` and `X-Forwarded-Host`, arriving from socket peer `127.0.0.1` with `Host: pi.share.example`
- **THEN** the device cookie SHALL carry `Secure`

#### Scenario: Https tunnel with an http base keeps Secure
- **GIVEN** the resolved base is a plain `http:` origin and a live https tunnel origin is `https://pi.share.example`
- **WHEN** a browser exchanges a valid bearer through the tunnel, arriving from peer `127.0.0.1` with `Host: pi.share.example`
- **THEN** the device cookie SHALL carry `Secure`

#### Scenario: Port-mismatched or non-https tunnel host does not qualify
- **WHEN** an exchange arrives from peer `127.0.0.1` with a `Host` that matches a live tunnel origin's host but not its port, or matches an `http:` tunnel origin, and the resolved base is `http:`
- **THEN** the device cookie SHALL NOT be marked `Secure` by the tunnel rule

### Requirement: Browser keeps its bearer until the cookie is proven
A browser that has just collected a device bearer (QR or knock pairing) SHALL discard its stored copy of the bearer only after an authenticated `/api/` request carried by the device cookie alone succeeds. If that request fails, it SHALL keep the bearer in the slot specific to its own API origin (never the legacy global slot), keep authenticating with it, and tell the user the browser could not keep its access in a cookie.

#### Scenario: Dropped cookie does not lock the device out
- **GIVEN** a browser whose cookie store rejects the device cookie
- **WHEN** pairing completes and the exchange returns 200
- **THEN** the cookie-only check request SHALL fail
- **AND** the browser SHALL still hold the bearer and its next `/api/` request SHALL be authenticated by it

#### Scenario: Kept bearer lives in the per-origin slot
- **GIVEN** a same-origin browser whose cookie-only check failed
- **WHEN** it keeps its bearer
- **THEN** the bearer SHALL be stored in the slot for its own API origin and SHALL NOT be written to the legacy global `pi-dashboard:device-bearer` slot

### Requirement: Browser-held device bearers expire and rotate
A bearer issued with a browser-holder declaration SHALL expire 7 days after issuance and never later than 30 days after original pairing. `POST /api/paired-devices/rotate` (route tier `observe`), authenticated only by `Authorization: Bearer` with the current unexpired bearer and acting on that bearer's own device only, SHALL return a fresh bearer for the same device id and tier within those limits; the previous bearer SHALL stay valid 60 seconds, then become invalid.

#### Scenario: Pairing response reports the first expiry
- **WHEN** a pairing code is redeemed, or its poll completes, with a browser-holder declaration
- **THEN** the response SHALL include `expiresAt` alongside the bearer, so the client can schedule rotation without a further call

#### Scenario: Browser bearer carries a 7-day expiry
- **WHEN** a client declaring a browser holder completes pairing
- **THEN** the bearer SHALL stop authenticating 7 days after issuance unless rotated

#### Scenario: Rotation returns a fresh bearer for the same device
- **WHEN** a browser calls `POST /api/paired-devices/rotate` with its unexpired bearer
- **THEN** the response SHALL contain a new plaintext bearer
- **AND** the device id, label and tier SHALL be unchanged

#### Scenario: Old bearer survives only a 60-second grace window
- **WHEN** a bearer is rotated and the previous bearer is used within 60 seconds
- **THEN** the request SHALL be authenticated
- **AND** the same previous bearer used after 60 seconds SHALL NOT be authenticated

#### Scenario: Grace-window bearer cannot rotate again
- **WHEN** a request to the rotation route presents a bearer already replaced by rotation
- **THEN** the request SHALL be refused and no further bearer SHALL be issued

#### Scenario: Absolute lifetime caps rotation
- **WHEN** a device is 30 days past its original pairing and presents a bearer to the rotation route, or the remaining absolute lifetime is under 7 days
- **THEN** past 30 days the response SHALL be 401 `bearer_expired` and the client SHALL re-pair
- **AND** within the final days the fresh bearer SHALL expire no later than the 30-day mark

#### Scenario: Non-browser bearers are unchanged
- **WHEN** a bearer was issued to the desktop keyring, the Electron shell, the CLI or a manual MCP token with no browser-holder declaration
- **THEN** it SHALL NOT expire and the rotation route SHALL leave it unchanged

#### Scenario: Rotation requires the bearer itself
- **WHEN** a request to `POST /api/paired-devices/rotate` carries no `Authorization: Bearer` header, whether it carries the device cookie, a local-proof credential, or nothing
- **THEN** the response SHALL be 401 with code `bearer_required` and no bearer SHALL be issued

#### Scenario: A device id in the body is ignored
- **WHEN** a request bearing device A's bearer posts a body naming device B's id
- **THEN** only device A's row SHALL be rotated; the body id SHALL have no effect

#### Scenario: Rotating an expiring browser row needs no declaration
- **WHEN** a browser row's unexpired bearer is sent to the rotation route without a browser-holder declaration
- **THEN** the row SHALL be rotated normally and a fresh bearer issued

#### Scenario: Same-origin browser that proves its cookie never declares a holder
- **WHEN** a same-origin browser pairs, exchanges its bearer for the device cookie and the cookie-only check succeeds
- **THEN** its row SHALL be a non-expiring row and the cookie path SHALL be unaffected
- **AND** "Browser keeps its bearer until the cookie is proven" SHALL apply, with the kept bearer held in the per-origin slot

### Requirement: Bearer rotation boundaries and failure semantics
Expiry, grace and absolute-lifetime limits SHALL be exclusive: a bearer is invalid once `now >= limit`. Only the immediately previous bearer has a grace window, lasting until the earlier of 60 s after rotation and its own expiry. Rotation SHALL be limited to 10 per device per sliding 60 s. A registry persist failure SHALL leave all state unchanged. A row whose `expiresAt` or `pairedAt` cannot be parsed SHALL be treated as expired.

#### Scenario: Limits are exclusive at the boundary
- **WHEN** a request presents a bearer at exactly its `expiresAt`, at exactly 30 days after original pairing, or exactly 60 s after its replacement
- **THEN** the bearer SHALL be treated as expired or invalid

#### Scenario: Only the immediately previous bearer has a grace window
- **WHEN** bearer A is rotated to B and B is rotated to C, and A is then presented within 60 s of the second rotation
- **THEN** A SHALL be invalid and B SHALL be the only previous bearer in grace

#### Scenario: Superseded bearer after grace is plainly unauthorized
- **WHEN** a superseded bearer is presented after its grace window, on any route including the rotation route
- **THEN** the response SHALL be 401 without any error code

#### Scenario: Grace never outlives the old bearer's own expiry
- **WHEN** a bearer is rotated 30 s before its own `expiresAt`
- **THEN** it SHALL authenticate until its own `expiresAt`, not for the full 60 s

#### Scenario: Rotation is rate limited per device
- **WHEN** one device calls the rotation route an eleventh time within a sliding 60 s window
- **THEN** the response SHALL be 429 with a `Retry-After` header and no bearer SHALL be issued

#### Scenario: Persist failure changes nothing
- **WHEN** the registry cannot be written during rotation
- **THEN** the response SHALL be 500 with code `rotation_failed`, no new bearer SHALL be issued and the presented bearer SHALL stay valid

#### Scenario: Only an exact browser declaration counts
- **WHEN** a pairing or rotation request carries a holder declaration other than exactly `holder:"browser"`
- **THEN** it SHALL be treated as carrying no declaration

#### Scenario: Unparseable timestamps fail closed
- **WHEN** a registry row has a malformed `expiresAt` or `pairedAt`
- **THEN** its bearer SHALL be treated as expired (401 `bearer_expired`)

### Requirement: Legacy non-expiring rows convert on browser declaration
A non-expiring row presented to the rotation route with an explicit browser-holder declaration SHALL be converted to a browser row: the returned bearer expires per the browser rules and the 30-day absolute lifetime counts from the conversion. Without a declaration the rotation route SHALL refuse with 409 `holder_declaration_required`, issue nothing and leave the row unchanged. Conversion only ever shortens a row's life.

#### Scenario: Legacy row converts when its browser declares itself
- **WHEN** a pre-existing non-expiring row's bearer is sent to the rotation route with the browser-holder declaration
- **THEN** the response SHALL carry a fresh bearer with a 7-day expiry and the row SHALL become an expiring row

#### Scenario: Legacy row without a declaration is unchanged
- **WHEN** a pre-existing non-expiring row's bearer is sent to the rotation route without the declaration
- **THEN** the response SHALL be 409 with code `holder_declaration_required`
- **AND** the row SHALL stay non-expiring and no new bearer SHALL be issued

### Requirement: Expired bearer is reported distinctly from revoked
A request presenting an expired browser bearer (past its 7-day expiry or its 30-day absolute lifetime) SHALL be refused with HTTP 401 and the error code `bearer_expired`, so a client can re-pair instead of retrying. An unknown or revoked bearer SHALL keep the existing unauthorized response without that code. Revoking a device SHALL invalidate every bearer of that device, including one in a rotation grace window.

#### Scenario: Expired bearer returns bearer_expired
- **WHEN** a request presents a browser bearer past its 7-day expiry
- **THEN** the response SHALL be 401 with code `bearer_expired`

#### Scenario: Bearer past the absolute lifetime returns bearer_expired
- **WHEN** a request presents a browser bearer whose device was originally paired more than 30 days ago
- **THEN** the response SHALL be 401 with code `bearer_expired`

#### Scenario: Expired bearer cannot rotate
- **WHEN** the rotation route is called with an expired bearer
- **THEN** the response SHALL be 401 `bearer_expired` and no bearer SHALL be issued

#### Scenario: Expiry is judged whatever the peer's trust
- **WHEN** an expired browser bearer is presented from a loopback or trusted-network peer
- **THEN** the response SHALL be 401 `bearer_expired`; a presented bearer is always judged and never ignored in favour of peer trust
- **AND** a loopback or trusted-network request that presents no bearer SHALL be admitted exactly as before (this scenario narrows only the presented-bearer case)

#### Scenario: Revoked device returns plain unauthorized
- **WHEN** a request presents the bearer of a revoked device
- **THEN** the response SHALL be 401 without the `bearer_expired` code

#### Scenario: Revoke kills the grace-window bearer
- **WHEN** a device is revoked within 60 seconds of a rotation
- **THEN** neither the new bearer nor the previous bearer SHALL authenticate
