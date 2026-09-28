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
SHALL be the SAME `https://<tls-endpoint>/pair#<payload-string>` deep link the QR
encodes, so a camera-less user can open it in another browser; an Electron/native
client SHALL accept the deep link by extracting the payload from its fragment.

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

#### Scenario: copy-string is the browser-openable deep link
- **WHEN** the operator copies the pairing copy-string for a selected TLS endpoint
- **THEN** the copy-string SHALL equal the QR's `https://<selected-tls>/pair#pi:pair:v1.…` deep link
- **AND** pasting it into another browser's address bar SHALL open the pairing view
- **AND** an Electron/native client pasting it SHALL decode the payload from the fragment

#### Scenario: one QR serves camera and Electron
- **WHEN** an Electron client scans the same `https://<tls-endpoint>/pair#<payload>` QR
- **THEN** the client SHALL extract the payload from the URL fragment and pair using it, identically to pasting the copy-string

#### Scenario: Only wss-reachable endpoints listed
- **WHEN** the server generates the payload and the tunnel is active but no TLS LAN URL is configured
- **THEN** `urls[]` contains the tunnel `wss://` URL and omits any plain-`http` LAN address

#### Scenario: No reachable endpoint
- **WHEN** no `wss://`-reachable endpoint exists (no tunnel, no TLS)
- **THEN** the pairing view SHALL explain that a tunnel or TLS is required to pair a remote device

### Requirement: Short-lived one-time pairing code
The pairing code SHALL expire within a short TTL (~300 seconds, long enough to
copy the deep link into another browser; the client countdown mirrors it), SHALL be
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
approval. The pairing code SHALL be consumed only on **approval** or on an
operator **deny**, never on redemption, so a premature redemption cannot lock out
the legitimate device. The
trust decision SHALL rely on a **server-generated numeric confirmation code shown
on BOTH the dashboard and the pairing device** for compare-and-match — NOT on any
client-supplied device label. The approval action SHALL require a genuine
authenticated browser session and SHALL NOT honor any loopback/tunnel exemption.
A pairing payload SHALL permit at most ONE active pending device at a time
(further redemptions overwrite the slot or are hard rate-limited), bounding memory
and approval-prompt flooding. The confirmation code SHALL have enough entropy to
resist brute-force within its short validity window. Approval SHALL be ACTIVE: the
user TYPES the code shown on the physical device into the dashboard. The dashboard
MAY push a prompt announcing the pending device, but that prompt SHALL NOT display
the confirmation code and SHALL NOT offer a one-click approve. Repeated invalid
approvals SHALL be rate-limited and locked out. The budget SHALL belong to one
pending device (a re-redemption creates a new pending device with a new
confirmation code and its own budget) and SHALL be shared by every approval entry
point for that pending device. Approval SHALL be rejected
if the pairing code has expired, and this check SHALL hold independently of any
lazy sweep, so the server remains the sole authority on code validity even when no
`poll`/mint has run.

#### Scenario: Premature redemption does not lock out the user
- **WHEN** an attacker redeems a shoulder-surfed code before the intended device AND the operator has not denied that request
- **THEN** the code is NOT consumed and the legitimate device can still redeem and be approved

#### Scenario: Deny ends the code for every device
- **WHEN** the operator denies a pending device
- **THEN** the code SHALL be consumed and no device, including a later legitimate one, SHALL be able to redeem it

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
- **WHEN** the user approves a device, including from a pushed approval prompt
- **THEN** they must type the code displayed on the physical pairing device, so a passively-pushed attacker request cannot be approved by habituated clicking
- **AND** the pushed prompt SHALL NOT contain the confirmation code

#### Scenario: Approval of an expired code rejected
- **WHEN** the operator submits the correct confirmation code after the pairing code has expired
- **THEN** the server SHALL reject the approval with an expired error and pair no device
- **AND** the rejection SHALL hold even if no intervening sweep has removed the entry

#### Scenario: Lockout budget shared across entry points
- **WHEN** the operator submits wrong confirmation codes for one pending device through both the Gateway view and the approval dialog
- **THEN** the attempts SHALL count against one budget and the device SHALL be locked out once that budget is exhausted

### Requirement: Versioned pairing handshake
The pairing payload and handshake SHALL carry a protocol version `v`, and the
server SHALL retain backward-compatible pairing routes so an independently
released client can pair using the highest mutually supported version.

#### Scenario: Version negotiated
- **WHEN** a client supporting versions 1–2 pairs with a server supporting version 1
- **THEN** the handshake completes using version 1

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
The web client SHALL implement the D12 active-typed approval: when a device
redeems a code and becomes PENDING, the client SHALL present the pending device
and a field for the operator to TYPE the numeric confirmation code displayed on
the physical device. Approval SHALL NOT be a one-click accept of a pushed prompt.
The approval control SHALL exist in two places only: the Gateway pairing view
(approving by pairing code) and the app-wide pairing approval dialog (approving by
pending-request identifier). Both SHALL be shown only to operator browsers.

#### Scenario: Correct confirm code approves the device
- **WHEN** the operator types the confirmation code shown on the pairing device AND submits
- **THEN** the client SHALL submit the approval with that confirm code
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

### Requirement: Pairing payload URL source is the promoted `publicBaseUrls`
The pairing payload's operator-designated addresses SHALL be sourced from the
top-level `publicBaseUrls` when that key is present, and from the legacy
`pairing.publicBaseUrls` when it is absent. No config file SHALL be rewritten on
read, so an existing configuration keeps working with no operator action.

The publicly-trusted-TLS gate is **UNCHANGED** by this promotion. It SHALL stay
authoritative at read time in `PairingManager.reachableUrls()`, which is what
makes it safe for OAuth-adjacent surfaces and the pairing payload to share one
input list: the two have different admissibility rules, and pairing's rule lives
downstream of the shared list. The gate SHALL NOT be moved upstream into config
parsing as a cleanup, because that would let a parse-level change silently widen
what reaches a QR code.

#### Scenario: Top-level key feeds the payload
- **WHEN** the config holds top-level `publicBaseUrls: ["https://pi.example.com"]` and no legacy key
- **THEN** the pairing payload's `urls[]` SHALL include `https://pi.example.com`

#### Scenario: Legacy key still feeds the payload
- **WHEN** the config holds only `pairing.publicBaseUrls: ["https://pi.example.com"]`
- **THEN** the pairing payload's `urls[]` SHALL include `https://pi.example.com`, byte-identically to the behaviour before the promotion

#### Scenario: Top-level key wins when both are present
- **WHEN** both keys are present with different values
- **THEN** the payload SHALL reflect the top-level list only

#### Scenario: The TLS gate still rejects a plain-http entry from the promoted list
- **WHEN** the promoted `publicBaseUrls` contains a non-loopback `http://` entry
- **THEN** `reachableUrls()` SHALL omit it and the pairing payload SHALL NOT contain it

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

### Requirement: App-wide pairing approval dialog
When a device redeems a pairing code, every connected operator browser SHALL
raise a modal approval dialog regardless of the page it shows, within one
WebSocket round-trip — except while another operator decision dialog (an
access-grant prompt) is open, in which case the approval dialog SHALL open as soon
as that dialog closes. The dialog SHALL show the requesting device's browser and
operating system (derived from its User-Agent), the host it arrived through, its
remote address, and how long ago it asked. It SHALL offer a field for the typed
confirmation code, an optional device-name field prefilled from the User-Agent,
a statement of the access that approval grants, an "Approve device" action and a
"Deny" action. Initial focus SHALL be on the confirmation-code field. Closing the
dialog SHALL leave the request pending. At most one approval dialog SHALL be shown
at a time; further pending requests SHALL be indicated as a count. When a request
is resolved elsewhere (another tab or operator, expiry), an open dialog for it
SHALL close and tell the operator it was handled elsewhere.

#### Scenario: Redeem raises the dialog on any page
- **WHEN** a device redeems a valid pairing code while an operator browser shows any dashboard page
- **THEN** that browser SHALL show the approval dialog for the pending device
- **AND** the dialog SHALL NOT display the confirmation code

#### Scenario: Paired-device browser never sees the dialog
- **WHEN** a device redeems a pairing code while a browser authenticated only by a paired-device token is connected
- **THEN** that browser SHALL NOT show the dialog and SHALL NOT receive the pending device's User-Agent, host or address

#### Scenario: Short code rejected on submit, not while typing
- **WHEN** the operator submits fewer than 8 digits
- **THEN** the dialog SHALL show "Enter all 8 digits" at the field and send no approval
- **AND** the Approve action SHALL NOT have been disabled while typing

#### Scenario: Wrong code shows remaining attempts
- **WHEN** the operator submits a non-matching code with attempts remaining
- **THEN** the dialog SHALL keep the typed value, mark the field invalid with text (not colour alone), and state how many attempts are left after this failure (4 after the first of 5)

#### Scenario: Lockout ends the request in the dialog
- **WHEN** the attempt budget is exhausted
- **THEN** the dialog SHALL replace the form with a "request blocked" message and offer only Close

#### Scenario: Closing keeps the request reviewable
- **WHEN** the operator closes the dialog without answering
- **THEN** the request SHALL stay pending until it expires
- **AND** the Gateway pairing view SHALL list it with a Review action that reopens the dialog

#### Scenario: Handled elsewhere closes the dialog
- **WHEN** a request whose dialog is open is approved, denied or expires through another browser or tab
- **THEN** the open dialog SHALL close and a notice SHALL say it was handled in another window

#### Scenario: Queue shows one dialog at a time
- **WHEN** two devices are pending
- **THEN** one dialog SHALL be shown with a "+1 more waiting" indicator and the next SHALL open after the first is resolved or closed

### Requirement: Operator can deny a pending device
An operator SHALL be able to deny a pending device. Denial SHALL require the same
operator authentication as approval and SHALL refuse a paired-device credential.
A denied device SHALL receive no token, its pairing code SHALL become unusable,
and the device's next status check SHALL report `rejected`. The browser pairing
landing and the native shell SHALL show that the dashboard declined the device and
that a new pairing link is needed.

#### Scenario: Deny rejects the device
- **WHEN** the operator denies a pending device
- **THEN** the device's status check SHALL return `rejected` and no token SHALL ever be issued for it

#### Scenario: Denied code cannot be redeemed again
- **WHEN** a pairing link whose pending device was denied is opened again
- **THEN** redemption SHALL be refused

#### Scenario: Device shows the decline
- **WHEN** the device landing receives `rejected`
- **THEN** it SHALL show "The dashboard declined this device" and SHALL NOT offer to retry the same link

#### Scenario: Paired device cannot deny
- **WHEN** a deny is submitted with only a paired-device credential
- **THEN** it SHALL be refused and the pending device SHALL be unchanged

### Requirement: Pending-request feed for operators
The server SHALL record, for each pending device, the redeemer's User-Agent, the
host it arrived through, its remote address, any proxy-reported client address
and the redemption time, each bounded in length. It SHALL expose the list of
pending devices (identifier, that metadata, expiry, attempts remaining) only to
operator callers, and SHALL notify connected browsers that the pending set changed
using a message that carries no request detail. Approval by pending-request
identifier SHALL be available to operator callers only. Redeemer metadata SHALL be
treated as untrusted display text: it SHALL NOT affect any authorization decision
and SHALL NOT be written to logs. Pairing codes and confirmation codes SHALL NOT be
included in the list, the notification, or logs.

#### Scenario: Change notification carries no detail
- **WHEN** a pending device is added, approved, denied, locked out or expires
- **THEN** connected browsers SHALL receive a change notification containing no identifier, address, User-Agent or code

#### Scenario: Pending list is operator-only
- **WHEN** the pending list is requested with only a paired-device credential or from an unauthenticated remote caller
- **THEN** the request SHALL be refused

#### Scenario: Expiry is announced without other traffic
- **WHEN** a pending device reaches its expiry while no other pairing request arrives
- **THEN** connected browsers SHALL receive the change notification and an open dialog for it SHALL close

#### Scenario: Approval label is bounded
- **WHEN** the operator approves from the dialog with a device name that is not a string or is outside 1..64 bytes of UTF-8 after trimming
- **THEN** the approval SHALL be rejected with a validation error and no device SHALL be paired

#### Scenario: Oversized metadata is bounded
- **WHEN** a device redeems with a User-Agent longer than 256 characters
- **THEN** the stored and listed value SHALL be truncated to at most 256 characters

#### Scenario: Reconnecting operator catches up
- **WHEN** an operator browser reconnects while a device is pending
- **THEN** it SHALL fetch the pending list and show the dialog without waiting for a new notification
