## MODIFIED Requirements

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

## ADDED Requirements

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
