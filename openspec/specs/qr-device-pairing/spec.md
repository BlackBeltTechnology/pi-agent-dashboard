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

