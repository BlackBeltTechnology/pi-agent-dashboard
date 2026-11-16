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
revocable per device regardless of source or tier: revoking SHALL move the device into the held revoked state defined by "Revoked devices are held, refused and restorable" and every bearer of the device, including one still in a rotation grace window, SHALL stop verifying at once; the device is deleted for good only after the retention period or an explicit delete-now. The tier SHALL be fixed at issuance; changing a device's tier SHALL
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
- **THEN** the device leaves the active registry and is held as revoked, and subsequent requests bearing that token are rejected

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
- **THEN** the device SHALL leave the active registry and be held as revoked, and the server SHALL respond `200`

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
A valid TLS-only (`pi_tls_`) bearer or device cookie presented on a non-proven
channel is the one exception: it SHALL be refused as "Bridge tokens issued on a
proven channel are TLS-only" states.

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

#### Scenario: TLS-only bearer refused off a proven channel
- **WHEN** a request on the main plaintext listener from a LAN address presents a valid `pi_tls_` bearer and matches no other allow path
- **THEN** the server responds 401 with error `tls_only_token_untrusted_channel`

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
The server SHALL expose `POST /api/paired-devices` accepting `{ label, tier?, purpose? }` and
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
every consumer (REST bearer branch, `/mcp` device caller resolution), except a
token minted with `purpose: "bridge"`, which follows "Bridge tokens issued on a
proven channel are TLS-only" and always has tier `operate`. `purpose` is either
absent or `"bridge"`.

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
- **WHEN** a client presents a manually minted token without the bridge purpose as `Authorization: Bearer` on `POST /mcp`
- **THEN** the request SHALL authenticate as a device caller with no originating session

#### Scenario: Manual rows are visible and revocable in Settings
- **WHEN** the Paired Devices list renders a `source: "manual"` row
- **THEN** it SHALL be visually marked as manually issued
- **AND** its revoke action SHALL behave as for pairing rows

#### Scenario: Bridge purpose follows the TLS-only rule
- **WHEN** an operator-authenticated request posts `{ "label": "laptop", "purpose": "bridge" }` on the native TLS listener with no forwarding header
- **THEN** the server SHALL respond `200` with a token starting with `pi_tls_` and a device view with tier `operate`

#### Scenario: Bridge purpose refused off a proven channel
- **WHEN** the same body is posted on the main plaintext listener from a LAN address without a local credential proof
- **THEN** the server SHALL respond `403` with error `bridge_token_requires_https` and the native HTTPS address when one exists
- **AND** no registry row SHALL be created

#### Scenario: Bridge purpose with a lower tier rejected
- **WHEN** the body carries `"purpose": "bridge"` with `"tier": "observe"`
- **THEN** the server SHALL respond `400`
- **AND** no registry row SHALL be created

#### Scenario: Unknown purpose rejected
- **WHEN** the body carries `purpose` with a value other than `bridge`
- **THEN** the server SHALL respond `400`
- **AND** no registry row SHALL be created

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

The identity and device-key routes a paired device uses to ask a server about
itself — `POST /api/pair/challenge`, `POST /api/pair/device-status` and
`POST /api/pair/device-key` — SHALL each be listed at `observe`. These routes
answer anonymous callers (or, for the key binding, any paired device), so a
credential the browser or app sends along automatically (the device cookie, or
a bearer) SHALL NOT make a lower-tier device worse off than an anonymous
caller: a device of every tier SHALL be able to run the identity challenge, the
device check and the key binding against its own server. The other public
pairing routes keep their existing tier.

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

#### Scenario: Observe-tier device runs the device check off-host
- **GIVEN** a device paired at tier `observe`, reaching the server from a non-loopback address that is not a trusted network, with its device cookie or bearer attached to every request
- **WHEN** it calls `POST /api/pair/challenge`, then `POST /api/pair/device-status`, then `POST /api/pair/device-key`
- **THEN** none of the three SHALL be refused with `insufficient_scope`, and each SHALL be answered as for any other caller

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

### Requirement: Plaintext bearer exposure is recorded
The registry SHALL record, once per device, the first time its bearer is presented on, or issued over, a non-proven channel. A proven channel is the native TLS listener with no proxy-forwarding header, or a request carrying a valid local credential proof. Bare loopback is not proven. The mark SHALL stand in memory even if persisting fails. It SHALL never contain the bearer or its hash. Devices created before this change SHALL read as having unknown history.

#### Scenario: Bearer presented over plain HTTP from the LAN
- **WHEN** a device bearer authenticates `POST /api/ws-ticket` arriving on the main plaintext listener from `192.168.1.20`
- **THEN** the device SHALL be recorded as exposed with the time of that request
- **AND** an audit line SHALL name the device id prefix and the channel, without the bearer

#### Scenario: Bearer used only over proven TLS stays unexposed
- **WHEN** a device bearer is issued and then presented only on the native TLS listener with no forwarding header
- **THEN** the device SHALL NOT be recorded as exposed

#### Scenario: Bare loopback is exposure
- **WHEN** a device bearer is presented from `127.0.0.1` on the main listener without a valid local credential proof
- **THEN** the device SHALL be recorded as exposed

#### Scenario: Legacy raw local token is not a proven channel
- **WHEN** a device token is issued on the main listener to a request carrying only the legacy raw `X-Pi-Local-Token`
- **THEN** the new device SHALL be recorded as exposed

#### Scenario: Local credential proof is a proven channel
- **WHEN** a device token is issued on the main listener to a request carrying a valid local credential proof
- **THEN** the new device SHALL NOT be recorded as exposed

#### Scenario: Forwarded request on the TLS listener is exposure
- **WHEN** a device bearer is presented on the native TLS listener with an `X-Forwarded-For` header
- **THEN** the device SHALL be recorded as exposed

#### Scenario: Token collected by a plain-HTTP poll is born exposed
- **WHEN** an operator approves a QR pairing over HTTPS and the device collects its token through a poll on the main plaintext listener from a LAN address
- **THEN** the new device SHALL be recorded as exposed

#### Scenario: Token collected over TLS is not exposed
- **WHEN** an operator approves a QR pairing over plain HTTP and the device collects its token through a poll on the native TLS listener
- **THEN** the new device SHALL NOT be recorded as exposed

#### Scenario: Bearer checked outside REST auth is still recorded
- **WHEN** a device bearer is checked on a plaintext live-server WebSocket upgrade
- **THEN** the device SHALL be recorded as exposed

#### Scenario: Bearer checked without a request is treated as unproven
- **WHEN** a plugin verifies a device bearer through the host service without passing its request
- **THEN** the device SHALL be recorded as exposed

#### Scenario: Exposure is written once
- **WHEN** an exposed device's bearer is presented over plain HTTP again
- **THEN** the recorded exposure time SHALL NOT change and the registry file SHALL NOT be rewritten for it

#### Scenario: Persist failure fails closed
- **WHEN** recording a first exposure fails to persist
- **THEN** the device SHALL still read as exposed, and the health endpoint SHALL report a pending exposure write
- **AND** the next successful persist SHALL include the exposure

#### Scenario: Pre-existing device has unknown history
- **WHEN** the registry loads a device row written before this change
- **THEN** that device SHALL read as having unknown exposure history

### Requirement: Bridge tokens issued on a proven channel are TLS-only
An operator-issued token with the bridge purpose SHALL be issued only on a proven channel, and SHALL carry the prefix `pi_tls_`. No other token SHALL carry it. Rotation SHALL keep a token's form and SHALL never clear a device's exposure record. A `pi_tls_` bearer on a non-proven channel SHALL be recorded as exposed, then refused with 401 and the distinct error `tls_only_token_untrusted_channel`.

#### Scenario: HTTPS bridge issue yields a TLS-only token
- **WHEN** an operator issues a token with the bridge purpose from the dashboard opened at `https://dash.example.ts.net:8443`
- **THEN** the token SHALL start with `pi_tls_` and its device SHALL NOT be exposed

#### Scenario: Bridge purpose refused over plain HTTP
- **WHEN** an operator requests a token with the bridge purpose from the dashboard opened at `http://192.168.1.10:8000`
- **THEN** no token SHALL be issued, and the `403` response SHALL carry the native HTTPS dashboard address

#### Scenario: MCP-client token stays plain
- **WHEN** an operator issues an MCP-client token from the dashboard opened over HTTPS
- **THEN** the token SHALL NOT start with `pi_tls_` and SHALL work on the dashboard's `http://` addresses as before

#### Scenario: Rotation keeps the form and the exposure
- **WHEN** an exposed device rotates its bearer through a request on the native TLS listener
- **THEN** the new token SHALL have the same form as the old one
- **AND** the device SHALL remain recorded as exposed

#### Scenario: TLS-only token over plain HTTP is refused
- **WHEN** a `pi_tls_` bearer is presented on the main plaintext listener
- **THEN** the request SHALL be answered 401 with error `tls_only_token_untrusted_channel`
- **AND** the device SHALL be recorded as exposed

#### Scenario: TLS-only token through an HTTPS-terminating proxy
- **WHEN** a `pi_tls_` bearer reaches the main listener through a tunnel that adds `X-Forwarded-For`
- **THEN** the request SHALL be answered 401 with error `tls_only_token_untrusted_channel`
- **AND** the device SHALL be recorded as exposed

#### Scenario: Token-issue dialog explains the bridge purpose
- **WHEN** an operator opens the token-issue dialog from a plain-HTTP dashboard address while the native TLS listener advertises `https://dash.example.ts.net:8443`
- **THEN** the bridge purpose SHALL be shown as unavailable, with `https://dash.example.ts.net:8443` as the address to use instead

#### Scenario: Token-issue dialog without a native HTTPS address
- **WHEN** an operator opens the token-issue dialog from a plain-HTTP dashboard address while Built-in HTTPS is off or bound to loopback
- **THEN** the bridge purpose SHALL be shown as unavailable, with "Turn on Built-in HTTPS to issue bridge tokens" and a link to the Built-in HTTPS section

### Requirement: Revoked devices are held, refused and restorable
Revoking a device SHALL record who revoked it and when, keep the whole device record (bearer hash, tier, source, label, keys, companions, and its expiry and rotation fields: `expiresAt`, `pairedAt`, and the previous-bearer hash with its `previousExpiresAt` when a rotation grace window exists) in a revoked store separate from the active registry file, and remove it from the active registry in the same operation. From that moment every credential of the device SHALL be refused — every bearer of the device including the previous bearer of a rotation grace window, the device cookie, WebSocket ticket minting, and a bridge reconnect — its live WebSocket connections SHALL be closed, and the device-key check SHALL answer `revoked` for its keys. Listing paired devices SHALL show active devices only. An operator SHALL be able to restore a revoked device, which SHALL return its id, bearer hash, tier, label, source, keys, companions and expiry and rotation fields exactly as held, so its original bearer works again without re-pairing for as long as that bearer is still within its original expiry (its last-seen time and any audit counters then continue from their current values). Restore SHALL NOT extend the 7-day expiry or the 30-day absolute lifetime, SHALL NOT restart a rotation grace window (a previous bearer is valid again only for what remains of its original grace), and a device whose bearer expired while it was held SHALL come back active but expired, its bearer answered `401` with `bearer_expired` and its keys answering `expired` to the device check; restore SHALL accept only an operator credential, by the same admission rule as revocation. Listing revoked devices, restoring and deleting now SHALL each accept only an operator credential and answer `401` to a paired-device bearer. Restoring or deleting an id that is not in the revoked store SHALL be answered `404`, and an id that is currently active `409`, changing nothing. Revoking an id that is unknown or already revoked SHALL be answered `404`, changing nothing. A revoked store that parses as JSON but has the wrong shape SHALL be treated like an unparseable one. A revoked device SHALL be deleted for good once 90 days have passed since its revocation (age of 90 days or more), or at once by an operator's delete-now; afterwards its token and keys are unknown and the check answers `unknown`. Expired records SHALL be purged at server start and whenever the revoked list is read or checked. Revoke, restore, delete-now and purge SHALL each write one audit line in the shape of the existing revoke line (`[pairing] <verb> id=<8-character prefix>`, with `actor=` and `ip=` when a request caused it, values sanitised by the shared audit emitter; verbs `revoked`, `restored`, `deleted`, `purged`), SHALL NOT audit a call that changes nothing (`404`, `409`), and SHALL NEVER write a token, hash, key, nonce or cookie. The revoked store SHALL be a separate `0600` file, so a build that predates it keeps treating a revoked device as deleted. If a device id is found in both files at start, the revoked record SHALL win. If the revoked store cannot be parsed at start, the server SHALL set the file aside under a distinct name, log an error and start with an empty revoked list, and the revoked-devices listing SHALL carry a warning that Settings shows as "Revoked-device list unreadable — revoked devices may be purged early"; because a revoked device's active row was removed when it was revoked, no revoked device is re-admitted.

#### Scenario: Revoked bearer is refused everywhere
- **GIVEN** device A holds bearer `T` and an open WebSocket
- **WHEN** an operator revokes A
- **THEN** a REST request with `T` SHALL be answered `401`, the device cookie SHALL be refused, a WebSocket ticket SHALL NOT be minted for it, and A's open sockets SHALL be closed

#### Scenario: Listing hides revoked devices
- **WHEN** paired devices are listed after A was revoked
- **THEN** A SHALL NOT appear in the active list and SHALL appear in the revoked list with its revoke time and the time it will be deleted

#### Scenario: Undo restores the device
- **WHEN** an operator restores revoked device A within 90 days, and A's bearer is still inside its original expiry
- **THEN** A SHALL be active again with the same id, bearer hash, label, tier, source, keys and companions, and its original bearer SHALL authenticate without re-pairing

#### Scenario: Revoke kills the grace-window bearer while held
- **GIVEN** device A rotated its bearer 10 seconds ago, so the previous bearer is still in its 60-second grace window
- **WHEN** an operator revokes A
- **THEN** neither the new bearer nor the previous bearer SHALL authenticate, and the held record SHALL keep both hashes and the previous bearer's original grace end

#### Scenario: Undo does not restart the grace window
- **GIVEN** A was revoked 10 seconds after a rotation, and restored 5 minutes later
- **WHEN** the previous bearer is presented
- **THEN** it SHALL be refused with a plain `401`, because its original grace window ended; the current bearer SHALL authenticate

#### Scenario: Undo never extends the expiry
- **GIVEN** a browser device whose bearer expires in 2 days and whose 30-day lifetime ends in 20 days
- **WHEN** it is revoked for 1 day and then restored
- **THEN** its `expiresAt` and absolute lifetime SHALL be unchanged and the bearer SHALL authenticate for about 1 more day

#### Scenario: Device that expired while revoked returns expired
- **GIVEN** a browser device revoked 1 day before its bearer's expiry, and restored 3 days later
- **WHEN** its bearer is presented
- **THEN** the response SHALL be `401` with `bearer_expired`, and the device check for its key SHALL answer `expired`

#### Scenario: Restore and delete-now are audited like revoke
- **WHEN** an operator restores a revoked device, deletes one now, or the server purges one at 90 days
- **THEN** one line `[pairing] restored id=<8> actor=<actor> ip=<peer>`, `[pairing] deleted id=<8> actor=<actor> ip=<peer>`, or `[pairing] purged id=<8>` SHALL be written, and no line SHALL contain a token, hash, key, nonce or cookie

#### Scenario: Unchanged calls are not audited
- **WHEN** restore or delete-now is refused with `404` or `409`, or a revoke of an unknown or already-revoked id is refused with `404`
- **THEN** no audit line SHALL be written

#### Scenario: Paired device cannot restore or delete
- **WHEN** a request authenticated only by a paired-device bearer restores or deletes a revoked device
- **THEN** the server SHALL respond `401` and change nothing

#### Scenario: Paired device cannot list revoked devices
- **WHEN** a request authenticated only by a paired-device bearer sends `GET /api/paired-devices/revoked`
- **THEN** the server SHALL respond `401` and return no device

#### Scenario: Restore of an unknown id
- **WHEN** an operator restores or deletes an id that is in neither store
- **THEN** the server SHALL respond `404`

#### Scenario: Revoke of an unknown or already-revoked id
- **WHEN** an operator revokes an id that is not an active device (never known, or already revoked)
- **THEN** the server SHALL respond `404` and change nothing

#### Scenario: Restore or delete-now of an active device
- **WHEN** an operator calls restore or delete-now with the id of a currently active device
- **THEN** the server SHALL respond `409` and change nothing

#### Scenario: Retention expires
- **WHEN** a device has been revoked for 90 days or more and the server starts or the revoked list is read
- **THEN** its record SHALL be deleted for good and its keys SHALL answer `unknown`

#### Scenario: Retention boundary
- **GIVEN** one device revoked 90 days minus one second ago and one revoked 90 days ago
- **WHEN** the server starts or the revoked list is read
- **THEN** the first SHALL be kept and listed and the second SHALL be deleted for good

#### Scenario: Delete now
- **WHEN** an operator chooses delete-now on a revoked device
- **THEN** its record SHALL be deleted at once and it SHALL NOT be restorable

#### Scenario: Older build treats it as deleted
- **WHEN** the active registry file is read by a build that does not know the revoked store
- **THEN** the revoked device SHALL NOT be present and its bearer SHALL be refused

#### Scenario: Crash between the two writes
- **GIVEN** a device id present in both the active file and the revoked store at start
- **THEN** the device SHALL be treated as revoked and removed from the active registry

#### Scenario: Wrong-shape revoked store is set aside
- **GIVEN** the revoked store file is valid JSON of the wrong shape at start
- **THEN** it SHALL be handled exactly as an unparseable file below

#### Scenario: Unreadable revoked store is set aside
- **GIVEN** the revoked store file is not valid JSON at start
- **THEN** the file SHALL be kept under a distinct name, an error SHALL be logged, the active devices SHALL be unaffected, and the revoked listing SHALL carry the unreadable-list warning

### Requirement: Paired devices settings show keys, companions and revoked devices
The Paired Devices settings section SHALL show for each active device a Device key column (its short id, `dk:` followed by 12 characters, or "none yet" when no key is registered) and a "Status checks from" column listing the origins of its companions (or none), each companion removable on its own. Revoke SHALL be an operator action that shows, for 10 seconds, a notice "<name> revoked" with an Undo action. The section SHALL list revoked devices separately with who and when it was revoked, "Deleted for good in N days", an "Undo revoke" action and a "Delete now" action, and SHALL state: "Undo only if you revoked by mistake. If the device was lost or stolen, leave it revoked: undo makes its saved access work again." "N days" SHALL be the remaining retention rounded up to whole days, and under 24 hours remaining SHALL read "Deleted for good in 1 day". Delete now SHALL ask for confirmation in a dialog naming the device before it acts. When Undo revoke finds the record gone or already restored (the server answers `404` or `409`), the section SHALL show an inline "No longer available" and refresh the lists. Revoke, Undo revoke, Delete now and companion removal SHALL be offered only when the viewer holds an operator credential.

#### Scenario: Key and companion columns
- **WHEN** the list shows a device with a key and one companion at `http://192.168.16.31:8000`
- **THEN** its row SHALL show the short key id and that origin under "Status checks from"

#### Scenario: Revoke offers undo
- **WHEN** the operator revokes a device
- **THEN** a notice "<name> revoked" with Undo SHALL show for 10 seconds, and choosing Undo SHALL restore the device

#### Scenario: Revoked list and warning
- **WHEN** a device is revoked
- **THEN** the revoked list SHALL show it with "Deleted for good in 90 days", Undo revoke and Delete now, and the lost-or-stolen warning SHALL be visible

#### Scenario: Remaining days round up
- **WHEN** a revoked device has 89 days 12 hours of retention left, or less than 24 hours
- **THEN** the revoked list SHALL read "Deleted for good in 90 days" and "Deleted for good in 1 day" respectively

#### Scenario: Delete now asks first
- **WHEN** the operator chooses Delete now on a revoked device
- **THEN** a confirmation dialog naming the device SHALL appear, and nothing SHALL be deleted until it is confirmed

#### Scenario: Undo of a record that is gone
- **WHEN** the operator chooses Undo revoke and the server answers `404` or `409`
- **THEN** the section SHALL show "No longer available" inline and refresh the list

#### Scenario: Unreadable revoked list warns
- **WHEN** the server reports the revoked list unreadable
- **THEN** the section SHALL show "Revoked-device list unreadable — revoked devices may be purged early"

#### Scenario: Device with no key
- **WHEN** a device row has no registered key
- **THEN** its Device key cell SHALL read "none yet"
