# qr-device-pairing Specification

## Purpose
Pair a device to a server via a QR / copy-string payload carrying a short-lived one-time code, with compare-code operator approval and a versioned handshake, exchanging the code for a durable credential over a proven-identity channel.
## Requirements
### Requirement: Pairing payload rendered as QR and copy-string
The server SHALL produce a pairing payload `{ v, id, code, urls[] }` — protocol
version, public-key fingerprint, a one-time pairing code, and every currently
`wss://`-reachable endpoint — and SHALL render it BOTH as a scannable QR code and
as a copyable text string (camera-less fallback).

#### Scenario: QR and copy-string presented together
- **WHEN** a user opens the pairing view
- **THEN** the dashboard shows a QR encoding the payload AND a copyable string encoding the same payload

#### Scenario: Only wss-reachable endpoints listed
- **WHEN** the server generates the payload and the tunnel is active but no TLS LAN URL is configured
- **THEN** `urls[]` contains the tunnel `wss://` URL and omits any plain-`http` LAN address

#### Scenario: No reachable endpoint
- **WHEN** no `wss://`-reachable endpoint exists (no tunnel, no TLS)
- **THEN** the pairing view SHALL explain that a tunnel or TLS is required to pair a remote device

### Requirement: Short-lived one-time pairing code
The pairing code SHALL expire within a short TTL (~60 seconds), SHALL be
redeemable at most once, and redemption attempts SHALL be rate-limited. The code
SHALL NOT itself be the durable credential.

#### Scenario: Code redeemed within TTL
- **WHEN** a device redeems a valid unexpired code
- **THEN** the server issues a bearer token and invalidates the code

#### Scenario: Expired or reused code rejected
- **WHEN** a device presents an expired or already-redeemed code
- **THEN** the server rejects the redemption and issues no token

### Requirement: Compare-code approval; code consumed on approval, not redemption
Redeeming a valid code SHALL create a PENDING device whose token is unusable until
approval. The pairing code SHALL be consumed only on **approval**, never on
redemption, so a premature redemption cannot lock out the legitimate device. The
trust decision SHALL rely on a **server-generated numeric confirmation code shown
on BOTH the dashboard and the pairing device** for compare-and-match — NOT on any
client-supplied device label. The approval action SHALL require a genuine
authenticated browser session and SHALL NOT honor any loopback/tunnel exemption.
A pairing payload SHALL permit at most ONE active pending device at a time
(further redemptions overwrite the slot or are hard rate-limited), bounding memory
and approval-prompt flooding. The confirmation code SHALL have enough entropy to
resist brute-force within its short validity window. Approval SHALL be ACTIVE: the
user TYPES the code shown on the physical device into the dashboard — not a
one-click approve of a pushed prompt. Repeated invalid redemptions SHALL be
rate-limited and locked out.

#### Scenario: Premature redemption does not lock out the user
- **WHEN** an attacker redeems a shoulder-surfed code before the intended device
- **THEN** the code is NOT consumed and the legitimate device can still redeem and be approved

#### Scenario: Spoofed label cannot be mistaken for the real device
- **WHEN** the user approves a pending device
- **THEN** approval requires matching the numeric confirmation code shown on the real device, so an attacker's chosen label cannot impersonate it

#### Scenario: Approval cannot be self-satisfied via a bypass
- **WHEN** an approval is attempted without a genuine authenticated browser session (e.g. via a loopback/tunnel path)
- **THEN** the approval SHALL be rejected

#### Scenario: Redemption flood cannot exhaust the server
- **WHEN** an attacker replays a QR payload to redeem many times
- **THEN** at most one pending device exists per payload and further attempts are rate-limited, so memory and approval prompts stay bounded

#### Scenario: Active typed approval defeats blind-approve
- **WHEN** the user approves a device
- **THEN** they must type the code displayed on the physical pairing device, so a passively-pushed attacker request cannot be approved by habituated clicking

### Requirement: Versioned pairing handshake
The pairing payload and handshake SHALL carry a protocol version `v`, and the
server SHALL retain backward-compatible pairing routes so an independently
released client can pair using the highest mutually supported version.

#### Scenario: Version negotiated
- **WHEN** a client supporting versions 1–2 pairs with a server supporting version 1
- **THEN** the handshake completes using version 1

### Requirement: Operator-side pairing view renders the payload
The dashboard web client SHALL provide an operator-side pairing view that, on open, calls `GET /api/pair/payload` and renders the returned `{ v, id, code, urls[] }` payload BOTH as a scannable QR code AND as a copyable base64url string. The view SHALL display the server fingerprint `id`, a countdown reflecting the one-time code TTL (~60s), and the list of `urls[]` currently advertised.

This closes the gap where the existing "pairing view" scenarios in this capability had no web-client implementation: `GET /api/pair/payload` shipped with zero callers.

#### Scenario: Payload rendered on open
- **WHEN** the operator opens the pairing view AND at least one `wss://`-reachable endpoint exists
- **THEN** the view SHALL show a QR encoding the payload AND the same payload as a copyable string
- **AND** the view SHALL show the fingerprint `id` and a TTL countdown for the one-time code

#### Scenario: No secure road → empty state
- **WHEN** `GET /api/pair/payload` returns `no_reachable_endpoint`
- **THEN** the view SHALL explain that a tunnel or a publicly-trusted TLS URL is required to pair a remote device
- **AND** SHALL offer an action to start a tunnel and note the `http://localhost` escape hatch

> The Add-HTTPS-URL affordance (manual non-tunnel `https`/`wss` endpoint entry via `pairing.publicBaseUrls`) is specified by `add-tunnel-providers`, not this change.

### Requirement: Operator approval via typed compare-code in the web client
The pairing view SHALL implement the D12 active-typed approval: when a device redeems a code and becomes PENDING, the view SHALL present the pending device and a field for the operator to TYPE the numeric confirmation code displayed on the physical device, calling `POST /api/pair/approve`. Approval SHALL NOT be a one-click accept of a pushed prompt.

Before this change, `/api/pair/approve` had no web-client caller, so an operator could not complete a pairing at all.

#### Scenario: Correct confirm code approves the device
- **WHEN** the operator types the confirmation code shown on the pairing device AND submits
- **THEN** the client SHALL call `POST /api/pair/approve` with the code and confirm code
- **AND** on success the device SHALL move into the paired-devices list

#### Scenario: Wrong confirm code rejected
- **WHEN** the operator types a non-matching confirmation code
- **THEN** the approval SHALL fail and the view SHALL show an error without pairing the device

### Requirement: Non-tunnel endpoint entry via the UI without hand-editing JSON

The dashboard SHALL let an operator add a non-tunnel `https://`/`wss://` pairing endpoint through the UI WITHOUT hand-editing any JSON config file, reusing the existing authenticated config-write path (`PUT /api/config`) — NOT a pairing-specific route. The control SHALL read the current config, append the entered URL to `pairing.publicBaseUrls`, and PUT the full `pairing` object back. After a successful add, the endpoint SHALL join the multi-sourced `getReachableUrls()` so it appears in the "Accessible at" list and, when TLS, in the pairing payload's `urls[]`. The `https`/`wss` gate is enforced server-side at read-time by `reachableUrls()` (D4/D14); any non-secure entry is dropped before advertisement regardless of how it was written.

Migrated from `wire-nonzrok-pairing-view` (Phase 2), because it feeds the same `getReachableUrls()` / `urls[]` source this change already rewrites for multi-provider endpoints. Before this change, `pairing.publicBaseUrls` had no UI affordance — forcing a hand-edit of `~/.pi/dashboard/config.json`.

#### Scenario: Operator adds an HTTPS URL via UI
- **WHEN** the operator submits `https://dashboard.example.com` in the Gateway endpoints "Add HTTPS URL" control
- **THEN** the client SHALL PUT the full `pairing` object (including the appended URL) to `PUT /api/config`
- **AND** the re-fetched endpoint list and pairing payload's `urls[]` SHALL include it
- **AND** no JSON file SHALL have been edited by hand

#### Scenario: Plain-http URL never advertised
- **WHEN** a `http://192.168.1.10:8000` entry reaches `pairing.publicBaseUrls` (via UI or hand-edit)
- **THEN** `reachableUrls()` SHALL omit it from the pairing payload's `urls[]`
- **AND** the UI SHALL reject the entry client-side with a message that only `https`/`wss` endpoints are accepted

#### Scenario: Write path is authenticated
- **WHEN** an unauthenticated request hits `PUT /api/config`
- **THEN** the request SHALL be rejected by the existing auth gate (same gate as `bindHost`/`bypassHosts`)

