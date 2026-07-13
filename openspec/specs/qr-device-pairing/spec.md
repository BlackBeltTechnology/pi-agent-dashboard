# qr-device-pairing Specification

## Purpose
Pair a device to a server via a QR / copy-string payload carrying a short-lived one-time code, with compare-code operator approval and a versioned handshake, exchanging the code for a durable credential over a proven-identity channel.
## Requirements
### Requirement: Pairing payload rendered as QR and copy-string
The server SHALL produce a pairing payload `{ v, id, code, urls[] }` — protocol
version, public-key fingerprint, a one-time pairing code, and every currently
`wss://`-reachable endpoint — and SHALL render it BOTH as a scannable QR code and
as a copyable text string (camera-less fallback).

The QR code SHALL encode a scannable `https://` deep link of the form
`https://<tls-endpoint>/pair#<payload-string>`, where `<tls-endpoint>` is a
publicly-trusted TLS endpoint from `urls[]` and `<payload-string>` is the same
base64url `pi:pair:v1.…` payload string carried in the URL **fragment**. A phone
camera SHALL therefore recognize the QR as an actionable `https` link and open the
browser pairing view. The one-time pairing code SHALL travel only in the URL
fragment (never the query string), so it is not sent to the server in the landing
request nor emitted in access logs or `Referer` headers. The copyable text string
SHALL remain the bare `pi:pair:v1.…` payload string (unchanged), so an
Electron/native client can paste it directly.

#### Scenario: QR and copy-string presented together
- **WHEN** a user opens the pairing view
- **THEN** the dashboard shows a QR encoding an `https://<tls-endpoint>/pair#<payload>` link AND a copyable string encoding the same payload

#### Scenario: QR is a camera-actionable https link
- **WHEN** a phone camera scans the pairing QR
- **THEN** the encoded value SHALL be an `https://` URL the camera can open in a browser
- **AND** the browser SHALL land on the `/pair` view carrying the payload in the URL fragment

#### Scenario: one-time code stays out of logs
- **WHEN** the pairing QR is generated
- **THEN** the one-time pairing code SHALL appear only in the URL fragment (after `#`) and never in the query string
- **AND** the landing request for `/pair` SHALL NOT transmit the code to the server (it is redeemed only via the `/api/pair/redeem` POST body)

#### Scenario: copy-string stays a bare payload for paste
- **WHEN** an Electron/native client copies the pairing copy-string
- **THEN** the copy-string SHALL be the bare `pi:pair:v1.…` payload (no `https://…/pair#` wrapper), decodable directly

#### Scenario: one QR serves camera and Electron
- **WHEN** an Electron client scans the same `https://<tls-endpoint>/pair#<payload>` QR
- **THEN** the client SHALL extract the payload from the URL fragment and pair using it, identically to pasting the bare copy-string

#### Scenario: Only wss-reachable endpoints listed
- **WHEN** the server generates the payload and the tunnel is active but no TLS LAN URL is configured
- **THEN** `urls[]` contains the tunnel `wss://` URL and omits any plain-`http` LAN address

#### Scenario: No reachable endpoint
- **WHEN** no `wss://`-reachable endpoint exists (no tunnel, no TLS)
- **THEN** the pairing view SHALL explain that a tunnel or TLS is required to pair a remote device

### Requirement: Short-lived one-time pairing code
The pairing code SHALL expire within a short TTL (~60 seconds), SHALL be
redeemable at most once, and redemption attempts SHALL be rate-limited. The code
SHALL NOT itself be the durable credential. A successful redemption SHALL restart
the code's TTL from the moment of redemption, so the operator-approval window
begins when the device presents itself rather than at payload mint — a payload
left on screen SHALL NOT shorten the window a redeeming device receives.

#### Scenario: Code redeemed within TTL
- **WHEN** a device redeems a valid unexpired code
- **THEN** the server issues a bearer token and invalidates the code

#### Scenario: Expired or reused code rejected
- **WHEN** a device presents an expired or already-redeemed code
- **THEN** the server rejects the redemption and issues no token

#### Scenario: Redemption restarts the approval window
- **WHEN** a device redeems a code near the end of the original mint TTL
- **THEN** the code's expiry SHALL restart from the redemption instant
- **AND** the device and operator SHALL retain a full short TTL to complete approval before the code expires

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
rate-limited and locked out. Approval SHALL be rejected if the pairing code has
expired, and this check SHALL hold independently of any lazy sweep, so the server
remains the sole authority on code validity even when no `poll`/mint has run.

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

#### Scenario: Approval of an expired code rejected
- **WHEN** the operator submits the correct confirmation code after the pairing code has expired
- **THEN** the server SHALL reject the approval with an expired error and pair no device
- **AND** the rejection SHALL hold even if no intervening sweep has removed the entry

### Requirement: Versioned pairing handshake
The pairing payload and handshake SHALL carry a protocol version `v`, and the
server SHALL retain backward-compatible pairing routes so an independently
released client can pair using the highest mutually supported version.

#### Scenario: Version negotiated
- **WHEN** a client supporting versions 1–2 pairs with a server supporting version 1
- **THEN** the handshake completes using version 1

### Requirement: Operator-side pairing view renders the payload
The dashboard web client SHALL provide an operator-side pairing view that, on open, calls `GET /api/pair/payload` and renders the returned `{ v, id, code, urls[] }` payload BOTH as a scannable QR code AND as a copyable base64url string. The view SHALL display the server fingerprint `id`, a countdown reflecting the one-time code TTL (~60s), and the list of `urls[]` currently advertised. The countdown SHALL be ADVISORY: it SHALL NOT disable the approval action when it reaches zero, because a redeeming device restarts the code's TTL server-side and the server is the sole authority on validity (it rejects a truly-expired code at approval time).

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

#### Scenario: Advisory countdown does not gate approval
- **WHEN** the operator-view TTL countdown reaches zero
- **THEN** the Approve control SHALL remain usable
- **AND** submitting SHALL defer the validity decision to the server, which pairs the device when the code is still valid or returns an expired error when it has lapsed

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

