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

## ADDED Requirements

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
