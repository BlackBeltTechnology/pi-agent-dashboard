## MODIFIED Requirements

### Requirement: Long-lived opaque bearer tokens in a revocable registry
A long-lived opaque bearer token SHALL be recorded in a server-side
paired-devices registry (`~/.pi/dashboard/paired-devices.json`, `0600`) with
device label, created-at, last-seen, and an issuance `source`. Tokens SHALL be
issued by one of two paths: redeeming a pairing code (`source: "pairing"`) or
direct issuance by an authenticated operator (`source: "manual"`). Both paths
SHALL return the plaintext token exactly once and store only a hash. The token
SHALL be revocable per device by deleting its registry entry regardless of
source. Registry rows written before `source` existed SHALL read as `"pairing"`.

#### Scenario: Token issued and recorded
- **WHEN** a device successfully redeems a pairing code
- **THEN** an opaque bearer token is returned and a registry entry with `source: "pairing"` is created for the device

#### Scenario: Device revoked
- **WHEN** a user revokes a device from Settings
- **THEN** its registry entry is deleted and subsequent requests bearing that token are rejected

#### Scenario: Legacy row without source
- **WHEN** the registry file contains a row that has no `source` field
- **THEN** the row SHALL be listed with `source: "pairing"`
- **AND** its token SHALL continue to verify

## ADDED Requirements

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
client" action that collects a label, calls the direct issuance route, shows the
plaintext token once, and renders a copyable client configuration snippet
targeting `/mcp` on the dashboard's reachable base URL.

#### Scenario: Snippet is copy-ready
- **WHEN** the operator completes the create-token flow
- **THEN** the UI SHALL show the token once with a copy control
- **AND** the UI SHALL show a `claude mcp add --transport http … /mcp --header "Authorization: Bearer <token>"` line using the same token

#### Scenario: Token is not shown again
- **WHEN** the operator dismisses the create-token result
- **THEN** the token SHALL NOT be retrievable from the UI
- **AND** the new row SHALL appear in the list marked as manually issued
