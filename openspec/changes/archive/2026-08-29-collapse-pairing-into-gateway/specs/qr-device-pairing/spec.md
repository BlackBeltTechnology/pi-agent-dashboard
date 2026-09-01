## MODIFIED Requirements

### Requirement: Operator-side pairing view renders the payload
The dashboard web client SHALL provide **exactly one** operator-side pairing
view — the Gateway **"Connect a device"** surface, rendered by both the Gateway
settings page and the toolbar Gateway dialog. On open it SHALL call
`GET /api/pair/payload` and render the returned `{ v, id, code, urls[] }` payload
BOTH as a scannable QR code AND as a copyable base64url string.

The surface offers a transport selector (D14's pairing/link split), and the
payload-bearing clauses are scoped to it: **whenever a pairing-eligible (TLS)
endpoint is the current selection**, the view SHALL display the server
fingerprint `id`, a countdown reflecting the one-time code TTL (~60s), the list
of `urls[]` currently advertised, the copy-string, and the approval control.
Selecting a non-TLS link endpoint legitimately swaps that panel for the link
note — a link endpoint has no payload to show. The default selection on open is
a TLS pairing endpoint whenever one exists, so the payload clauses hold in the
default state.

The countdown SHALL be ADVISORY: it SHALL NOT disable the approval action when
it reaches zero, because a redeeming device restarts the code's TTL server-side
and the server is the sole authority on validity (it rejects a truly-expired
code at approval time).

The QR SHALL be camera-scannable: it encodes the
`https://<selected-tls-endpoint>/pair#pi:pair:v1.<b64>` deep link, with the
payload in the FRAGMENT so the one-time code never reaches the server or its
logs. The copyable string stays the bare `pi:pair:v1.…` payload for paste into
the Electron shell. No other settings surface SHALL render a pairing QR, a
pairing copy-string, or an approval control.

The fingerprint SHALL be displayed in full, not as a truncated prefix; a
shortened form MAY additionally appear as a compact caption. The advertised
`urls[]` SHALL be taken from the pairing payload itself, NOT from the endpoint
list the surface uses for selection — the payload is TLS-filtered server-side,
so the two sets can legitimately differ, and it is the payload's set the device
will act on.

The "no secure road" condition SHALL be keyed on the `GET /api/pair/payload`
response, NOT on whether any endpoint exists. A deployment with non-TLS link
endpoints and no TLS endpoint receives `no_reachable_endpoint` while still
having endpoints to display; the explanation, the action, and the escape-hatch
note SHALL render in that case too.

This closes the gap where the existing "pairing view" scenarios in this
capability had no web-client implementation: `GET /api/pair/payload` shipped
with zero callers. Naming the surface closes the successor gap: the previous
wording was indefinite, and two independent implementations each read it as a
mandate, drifting into a scannable compliant one on Gateway and a
non-scannable non-compliant one on Security.

#### Scenario: Payload rendered on open
- **WHEN** the operator opens the pairing view AND at least one `wss://`-reachable endpoint exists
- **THEN** the view SHALL show a QR encoding the payload AND the same payload as a copyable string
- **AND** the view SHALL show the fingerprint `id` and a TTL countdown for the one-time code

#### Scenario: No secure road → empty state
- **WHEN** `GET /api/pair/payload` returns `no_reachable_endpoint`
- **THEN** the view SHALL explain that a tunnel or a publicly-trusted TLS URL is required to pair a remote device
- **AND** SHALL offer an action to start a tunnel and note the `http://localhost` escape hatch

#### Scenario: No secure road WITH link endpoints present
- **WHEN** `GET /api/pair/payload` returns `no_reachable_endpoint` AND one or more non-TLS link endpoints exist
- **THEN** the explanation, the start-a-tunnel action, and the `http://localhost` note SHALL still render
- **AND** they SHALL render alongside the link-endpoint panel rather than replacing it, because a link QR remains usable for direct access even though it is not pairing

#### Scenario: Start-a-tunnel action is always present
- **WHEN** the "no secure road" condition holds on any host that renders the pairing view
- **THEN** an action leading to Gateway setup SHALL render
- **AND** a host MAY redirect that action to its own setup surface, but SHALL NOT remove it
- **AND** the action SHALL perform a real navigation or focus change — a host already AT the Gateway setup route SHALL move focus to the setup controls rather than re-navigating to the route it is on

#### Scenario: The condition is not inferred from an unloaded payload
- **WHEN** the pairing view is mounted and `GET /api/pair/payload` has not yet resolved
- **THEN** the "no secure road" explanation, action, and escape-hatch note SHALL NOT render
- **AND** the condition SHALL be carried by the `no_reachable_endpoint` response itself, not derived from the payload being absent — an absent payload is also the loading state

#### Scenario: Fingerprint shown in full
- **WHEN** a pairing payload is displayed
- **THEN** the complete fingerprint `id` SHALL be present and selectable, not only a truncated prefix

#### Scenario: Advertised urls come from the payload
- **WHEN** a pairing endpoint is selected and its payload is displayed
- **THEN** the `urls[]` shown SHALL be the payload's own list, not the surface's endpoint-selection list

#### Scenario: Pairing QR is camera-scannable
- **WHEN** the pairing view renders the QR for a TLS endpoint
- **THEN** the encoded value SHALL be an `https://…/pair#pi:pair:v1.<b64>` deep link a phone camera can open
- **AND** the one-time code SHALL appear only in the URL fragment

#### Scenario: No second pairing surface
- **WHEN** the operator opens any settings page other than Gateway
- **THEN** no pairing QR, pairing copy-string, or pairing approval control SHALL be rendered there

> The Add-HTTPS-URL affordance (manual non-tunnel `https`/`wss` endpoint entry via `pairing.publicBaseUrls`) is specified by `add-tunnel-providers`, not this change.

### Requirement: Operator approval via typed compare-code in the web client
The Gateway pairing view SHALL implement the D12 active-typed approval: when a
device redeems a code and becomes PENDING, the view SHALL present the pending
device and a field for the operator to TYPE the numeric confirmation code
displayed on the physical device, calling `POST /api/pair/approve`. Approval
SHALL NOT be a one-click accept of a pushed prompt. The approval control SHALL
exist on that surface only.

Before the original change, `/api/pair/approve` had no web-client caller, so an
operator could not complete a pairing at all. It subsequently had two, one of
which gated the control on the advisory countdown in contradiction of the
scenario below.

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

## ADDED Requirements

### Requirement: Security settings routes to the pairing surface
The Security settings page SHALL retain a "Pair a device" affordance that
NAVIGATES to the Gateway pairing surface rather than reimplementing it. Security
retains the durable half of device trust — the paired-devices list, revocation,
authentication providers, and trusted networks — while the transient act of
pairing lives with the endpoint it pairs over.

The cross-link SHALL be bidirectional: the Gateway surface already offers
"Open Security →" for trust review, and Security offers the pairing link, so
neither page dead-ends an operator who arrived from the other.

#### Scenario: Security offers a route, not a duplicate
- **WHEN** the operator opens Settings ▸ Security and looks for "Pair a device"
- **THEN** a link to the Gateway pairing surface SHALL be present
- **AND** activating it SHALL land on the Gateway "Connect a device" QR

#### Scenario: Paired-device management stays on Security
- **WHEN** the operator opens Settings ▸ Security
- **THEN** the paired-devices list and its revocation controls SHALL still be rendered there

### Requirement: Single pairing-QR encoder
Pairing payload encoding SHALL have exactly one implementation in the web
client — the shared `lib/pairing/pairing-qr.ts` codec module exporting the
copy-string encoder, the deep-link encoder, and the decoder. No component SHALL
carry a private payload encoder.

Two encoders is how the surfaces drifted: the shared module gained the
camera-scannable deep link while the private copy kept emitting a bare payload
no camera could act on.

#### Scenario: One encoder module
- **WHEN** the client source is searched for a pairing payload encoder
- **THEN** only the shared codec module SHALL define one
- **AND** every pairing surface SHALL import it rather than reimplement it

#### Scenario: TLS re-guard before encoding is fail-closed
- **WHEN** a pairing payload is encoded for display
- **THEN** its `urls[]` SHALL be re-guarded client-side, independent of the server read-time gate
- **AND** the guard SHALL be **fail-closed** — a non-TLS entry SHALL raise and abort the encode, NOT be silently filtered out of an otherwise-rendered payload, because a partially-sanitised payload hides a server-side gate failure the operator needs to see
