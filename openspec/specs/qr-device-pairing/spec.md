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
client-supplied device label. The approval action (`POST /api/pair/approve`, `POST /api/pair/approve-pending`)
SHALL require an operator proof — a dashboard login session, a valid local-proof
cookie (see `trust-and-credential-boundaries`), or a verified local credential
presented as `X-Pi-Local-Proof` (and, only while the legacy window named by
`local-ipc-allowlist-token` remains open, a valid `X-Pi-Local-Token`) —
and SHALL NOT honor a bare loopback/tunnel exemption in any mode, regardless of
`requireLocalProof`. A paired-device bearer SHALL never approve.
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

A refusal of an approval action for want of an operator credential SHALL answer
401 with a body whose `error` is `operator credential required` and which also
carries a `reason` and an ordered, duplicate-free `remedies` array. `reason` SHALL
be `device-credential` when the caller presented a paired-device credential and
`no-credential` otherwise. For `device-credential` the `remedies` array SHALL be
empty. For `no-credential` the array SHALL be drawn from the values
`authorize-browser`, `approve-on-host` and `sign-in`, in that relative order,
where:
- `authorize-browser` SHALL be present exactly when the refused request is
  genuinely local by the TRANSPORT test alone — loopback peer and no proxy
  forwarding header — and presented no local proof, AND the request's `Host`
  header satisfies the same origin rule the launcher applies to a named origin
  (host `localhost` or a loopback address, port — explicit or the scheme default —
  equal to the server's configured port), evaluated by one shared definition so
  the dashboard never offers a launcher command the launcher would refuse. This
  test SHALL NOT itself require local proof, in either `requireLocalProof` mode,
  so the caller who needs the remedy is the caller who is offered it;
- `approve-on-host` SHALL always be present;
- `sign-in` SHALL be present exactly when a usable login method is configured at
  the time of the refusal, by the same rule `operate-required-remedy` applies.

`reason` and `remedies` SHALL be attached only when the refused request's `Host`
is admitted by the same host-admission check, with the same options, that the
approval action applies to admitted callers. When the `Host` is not admitted, the
refusal SHALL keep its status and SHALL carry exactly the keys `success` and
`error` — whichever host-gate mode is in force — so that no caller whose Host is
not admitted learns its network position or whether a login method exists. Which
check runs first, and which callers are admitted, SHALL NOT change.

When attached, the body SHALL contain only the keys `success`, `error`, `reason` and `remedies`,
and SHALL disclose nothing beyond the caller's own network position and the
existence of a login method — in particular no pending-request identifier, device
label, host name, address, or pairing state. Clients SHALL ignore `remedies`
values they do not recognise, and a body without `reason`/`remedies` SHALL remain
valid for older servers. Which callers are admitted SHALL NOT change.

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

#### Scenario: Bare loopback cannot approve
- **WHEN** an approval request arrives from `127.0.0.1` with no forwarding header, no login session, no local-proof cookie, and no local token, with `requireLocalProof` disabled
- **THEN** the approval SHALL be rejected with 401 and the pending device SHALL stay pending

#### Scenario: Bare loopback refusal names the remedies
- **WHEN** that same bare-loopback approval is refused and no login method is configured
- **THEN** the body SHALL carry `reason` `no-credential` and `remedies` exactly `["authorize-browser", "approve-on-host"]`

#### Scenario: Local request on a non-configured origin is not offered authorize-browser
- **GIVEN** the server's configured port is `8000`
- **WHEN** a bare-loopback approval request with no proof arrives with `Host: localhost:9000` (e.g. through an SSH local port forward) and no login method is configured
- **THEN** the body SHALL carry `reason` `no-credential` and `remedies` exactly `["approve-on-host"]`

#### Scenario: Remedy position test is independent of strict mode
- **GIVEN** `requireLocalProof` is `true`
- **WHEN** a bare-loopback approval request with no proof is refused
- **THEN** `remedies` SHALL still contain `authorize-browser`, because the position test is the transport test alone
- **AND** the same request under `requireLocalProof` `false` SHALL receive the same `remedies` array

#### Scenario: Remedy computation never turns a refusal into an error
- **WHEN** the accessor that reports whether a login method is configured is absent or raises
- **THEN** the response SHALL still be the 401 refusal, with `sign-in` omitted from `remedies`
- **AND** no 5xx SHALL be returned

#### Scenario: Non-admitted Host in enforce mode gets the host refusal
- **GIVEN** the host gate is in `enforce` mode
- **WHEN** a request whose `Host` header is not admitted attempts an approval without a credential
- **THEN** the host-admission refusal SHALL be returned
- **AND** the response SHALL NOT carry `reason` or `remedies`

#### Scenario: Non-admitted Host in report mode gets the legacy refusal
- **GIVEN** the host gate has been switched to `report` mode and a login method is configured
- **WHEN** a request whose `Host` header is not admitted attempts an approval without a credential
- **THEN** the response SHALL be the 401 refusal with exactly the keys `success` and `error`, `error` being `operator credential required`
- **AND** it SHALL carry neither `reason` nor `remedies`, so the caller learns nothing about whether a login method is configured

#### Scenario: Off-host refusal omits authorize-browser
- **WHEN** an approval request arrives through a tunnel host with no credential and an OAuth provider with a non-empty client id is configured
- **THEN** the body SHALL carry `reason` `no-credential` and `remedies` exactly `["approve-on-host", "sign-in"]`

#### Scenario: Device credential refusal offers no remedy
- **WHEN** a browser authenticated only by a paired-device credential attempts an approval
- **THEN** the refusal SHALL be 401 with `reason` `device-credential` and an empty `remedies` array

#### Scenario: Refusal body discloses nothing about the request or the host
- **GIVEN** a pending device labelled `robson-phone` at `192.168.16.31` and a server host name `office-mac`
- **WHEN** a credential-less caller is refused an approval
- **THEN** the body SHALL have exactly the keys `success`, `error`, `reason`, `remedies`
- **AND** no string in it SHALL contain the pending identifier, `robson-phone`, `192.168.16.31` or `office-mac`

#### Scenario: Local-proof cookie approves on an auth-off install
- **WHEN** authentication is disabled and a browser bootstrapped via the launcher presents a valid local-proof cookie with the matching confirmation code
- **THEN** the approval SHALL succeed

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
settings page and the Remote access dialog's "Open it on the device" step
(https endpoints only; that step renders its own plain-http link). On open it SHALL call
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
When a device redeems a pairing code or an admitted knock creates a pending
device, every connected operator browser SHALL
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

The dialog SHALL state the request's provenance. For a knock it SHALL title the
request with the source address ("A device on 192.168.16.31 asks to connect"),
SHALL show a requester name only inside a requester-attributed phrase ("says it is
…"), and SHALL prefill the device-name field from the requester name when present,
else from the User-Agent. For a knock received over an unencrypted connection it
SHALL show a warning, in text and not by colour alone, that the request and the
resulting access travel unencrypted on this network. For a knock it SHALL also
offer the tier choice specified by `lan-knock-pairing` ("Operator chooses the
tier of a knock-paired device"), and its consequence statement SHALL name the
selected tier. A QR redemption SHALL keep its existing presentation.

When an approval is refused for want of an operator credential and the refusal
carries a `remedies` list, the dialog SHALL render one instructional row per
remedy it recognises, in the order received, ignoring values it does not
recognise, instead of a single explanatory sentence. The `authorize-browser` and
`approve-on-host` rows SHALL each present the exact command to run as selectable
text with a copy control; the `approve-on-host` row's command SHALL name this
request, and SHALL NOT contain the confirmation code, so the code is never placed
on the clipboard or in a shell history. Because the credential the
`authorize-browser` command obtains is bound to one origin, that command SHALL
name the origin of the page showing the dialog, so running it credentials the tab
that was refused; the dialog SHALL NOT present a command that would credential a
different origin. The launcher SHALL accept a named origin only when its scheme is
`http` or `https`, its host is `localhost` or a loopback address, and its port is
the server's configured port, and SHALL refuse any other origin before any
credential or single-use code is minted. A development client build SHALL NOT
render the `authorize-browser` row, since its origin is not the server's port. The
`sign-in` row SHALL link to the dashboard login page. Throughout, the dialog SHALL
keep the typed confirmation code, the device name, the tier selection and the
countdown, and SHALL keep "Approve device" enabled, so the operator can retry in
place while the request is still pending. A refusal without a `remedies` list — an
older server — SHALL keep rendering the existing explanatory sentence. The dialog
SHALL NOT retry an approval on its own. When a Deny is refused for want of an
operator credential, the dialog SHALL render the remedy rows of that refusal by
the same rules, SHALL keep the request open, and SHALL keep Deny available for
retry.

#### Scenario: Redeem raises the dialog on any page
- **WHEN** a device redeems a valid pairing code while an operator browser shows any dashboard page
- **THEN** that browser SHALL show the approval dialog for the pending device
- **AND** the dialog SHALL NOT display the confirmation code

#### Scenario: Knock raises the dialog with its provenance
- **WHEN** a knock from `192.168.16.31` with name `Roberts-MacBook-Pro` is admitted while an operator browser shows any dashboard page
- **THEN** that browser SHALL show the approval dialog titled with `192.168.16.31`
- **AND** the name SHALL appear only as "says it is Roberts-MacBook-Pro" and SHALL prefill the device-name field
- **AND** a tier radio group SHALL be shown with Operate preselected
- **AND** the dialog SHALL NOT display the confirmation code

#### Scenario: Unencrypted knock is labelled
- **WHEN** the dialog shows a knock received over plain http
- **THEN** it SHALL show a text warning that the request and the resulting access are unencrypted on this network

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

#### Scenario: Credential refusal lists the remedies
- **WHEN** an approval is refused with `remedies` `["authorize-browser", "approve-on-host"]`
- **THEN** the dialog SHALL show two instructional rows in that order, each with a copyable command
- **AND** the `approve-on-host` command SHALL contain this request's identifier and SHALL NOT contain the confirmation code
- **AND** the single "needs an operator credential" sentence SHALL NOT be shown

#### Scenario: Authorize-browser command names the tab's own origin
- **GIVEN** the dialog is shown in a tab whose origin is `http://127.0.0.1:8000` while the launcher's default origin is `http://localhost:8000`
- **WHEN** an approval is refused with `authorize-browser` among the remedies
- **THEN** the command shown SHALL target `http://127.0.0.1:8000`, so the credential it obtains applies to this tab

#### Scenario: Launcher refuses an origin on another port

- **WHEN** the operator runs the launcher naming `http://localhost:9999` while the server's configured port is `8000`
- **THEN** the launcher SHALL exit non-zero naming the configured port
- **AND** no single-use code SHALL have been minted and no browser SHALL be opened

#### Scenario: Retry in place after obtaining the credential
- **GIVEN** an approval was refused for want of a credential and the remedy rows are shown
- **WHEN** the operator obtains the credential and activates "Approve device" again without reopening the dialog
- **THEN** the previously typed confirmation code, device name and tier SHALL still be submitted
- **AND** on success the dialog SHALL show the paired state

#### Scenario: Refusal does not auto-retry
- **WHEN** an approval is refused for want of a credential
- **THEN** the dialog SHALL issue no further approval request until the operator activates the approve action

#### Scenario: Refused deny shows the same remedies
- **WHEN** the operator activates Deny in a tab without an operator credential and the refusal carries `remedies` `["authorize-browser", "approve-on-host"]`
- **THEN** the dialog SHALL show the same two remedy rows, SHALL keep the request open, and the request SHALL stay pending

#### Scenario: Older server keeps the sentence
- **WHEN** an approval is refused 401 with `error` `operator credential required` and no `remedies` field
- **THEN** the dialog SHALL show the existing explanatory sentence and no remedy rows

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

A refusal of a deny for want of an operator credential SHALL carry the same status
and body, by the same rules, as a refusal of an approval for want of an operator
credential (`reason`, `remedies`, and their Host-admission condition), and SHALL
leave the pending device unchanged.

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

#### Scenario: Bare loopback cannot deny
- **WHEN** a deny arrives from `127.0.0.1` with no forwarding header, no login session, no local-proof cookie and no local credential, with `requireLocalProof` disabled
- **THEN** it SHALL be refused with 401, the pending device SHALL stay pending, and its pairing code SHALL NOT be consumed
- **AND** the body SHALL carry `reason` `no-credential` and the same `remedies` an approval refusal from that request would carry

#### Scenario: Host credential can deny
- **WHEN** a deny is submitted with a verified local credential presented as `X-Pi-Local-Proof` (as the host-side terminal sends)
- **THEN** the pending device SHALL be denied

### Requirement: Pending-request feed for operators
The server SHALL record, for each pending device, the redeemer's User-Agent, the
host it arrived through, its remote address, any proxy-reported client address
and the redemption time, each bounded in length. It SHALL additionally record the
pending device's provenance (`qr` or `knock`), and for a knock the bounded
requester name when supplied and whether the knock arrived unencrypted. It SHALL
expose the list of pending devices (identifier, that metadata, provenance,
requester name, unencrypted flag, expiry, attempts remaining) only to
operator callers, and SHALL notify connected browsers that the pending set changed
using a message that carries no request detail. Approval by pending-request
identifier SHALL be available to operator callers only. Redeemer metadata and the
requester name SHALL be
treated as untrusted display text: they SHALL NOT affect any authorization decision
and SHALL NOT be written to logs. Pairing codes and confirmation codes SHALL NOT be
included in the list, the notification, or logs. Clients SHALL treat an absent
provenance as `qr`.

#### Scenario: Change notification carries no detail
- **WHEN** a pending device is added, approved, denied, locked out or expires
- **THEN** connected browsers SHALL receive a change notification containing no identifier, address, User-Agent or code

#### Scenario: Pending list is operator-only
- **WHEN** the pending list is requested with only a paired-device credential or from an unauthenticated remote caller
- **THEN** the request SHALL be refused

#### Scenario: Provenance is listed
- **GIVEN** one pending device from a QR redemption and one from an unencrypted knock named `Roberts-MacBook-Pro`
- **WHEN** an operator lists pending devices
- **THEN** the first entry SHALL carry provenance `qr` and the second provenance `knock`, requester name `Roberts-MacBook-Pro` and the unencrypted flag set
- **AND** neither entry SHALL carry a pairing code or confirmation code

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

### Requirement: Approval refuses a paired-device credential and bounds the label
The approval action SHALL refuse any request whose only credential is a
paired-device bearer token, independent of the caller's network position. An
optional operator-supplied `label` on approval SHALL be trimmed and SHALL be
accepted only when it is 1..64 bytes of UTF-8 — the same bound as direct token
issuance; a label outside that bound SHALL be rejected with `400` and no device
SHALL be approved. A supplied `label` that is not a string SHALL likewise be
rejected with `400`, not treated as absent — only a genuinely absent key takes
the keep-the-pending-label branch. When no label is supplied the pending
device's own label is kept.

#### Scenario: Paired device cannot approve a pending device
- **GIVEN** a pending device awaiting approval
- **WHEN** a request authenticated only by an existing paired-device bearer posts the correct code and confirm code to the approval route
- **THEN** the server SHALL respond `401`
- **AND** the pending device SHALL remain pending and its token SHALL NOT verify

#### Scenario: Oversized approval label is rejected
- **WHEN** an operator posts a valid code and confirm code with a `label` of 65 bytes of UTF-8
- **THEN** the server SHALL respond `400`
- **AND** the pending device SHALL remain pending

#### Scenario: Supplied non-string label is rejected
- **WHEN** an operator posts a valid code and confirm code with `label: 123`
- **THEN** the server SHALL respond `400`
- **AND** the pending device SHALL remain pending
- **AND** the server SHALL NOT respond `200` while silently keeping the pending label

#### Scenario: Label absent keeps the pending label
- **WHEN** an operator approves without a `label`
- **THEN** the paired device SHALL carry the label recorded at redemption

### Requirement: Host-side pairing approval from a terminal

The dashboard CLI SHALL offer an approval path usable from any shell that runs on
the same operating-system user and host as the server process, so a pairing can be
answered where no browser can obtain an operator credential — a headless or SSH-only host, a container, WSL, a tunnel
origin, or a browser tab that was not opened by the dashboard launcher.

The CLI SHALL provide verbs to list the pending requests, approve one, and deny
one. Listing SHALL show, per pending request, its identifier, how the request
arrived, the requesting device's self-reported description, its address and when
it expires, and SHALL NOT show the confirmation code.

Every server-supplied string the CLI prints SHALL first be rendered inert for a
terminal by REMOVING at least: C0 controls and DEL (`U+0000` to `U+001F`,
`U+007F`), C1 controls (`U+0080` to `U+009F`), bidirectional overrides and
isolates (`U+202A` to `U+202E`, `U+2066` to `U+2069`), zero-width and format
characters (`U+200B` to `U+200F`, `U+FEFF`), and the line and paragraph separators
`U+2028` and `U+2029`; and then by truncating the result to a fixed per-field
maximum length. That length SHALL be measured in Unicode code points; a truncated
value SHALL end with `…`, which SHALL count within the maximum; and truncation
SHALL NOT split a surrogate pair. The removal set SHALL be the one the server already applies to a
knock requester name, applied through a single shared definition rather than a
second one.

Approval from the CLI SHALL require the operator to supply the confirmation code
displayed on the requesting device; the CLI SHALL read it interactively by
default, and SHALL accept it as an argument only through an explicit option
documented as visible to other processes on the host. When no code option is
given and standard input is not a terminal, the CLI SHALL read the first line of
standard input as the code; end of input or an empty line SHALL end the command
with a non-zero outcome and no request sent. Before sending, the CLI SHALL remove
spaces and dashes from the supplied code, and SHALL refuse locally — non-zero, no
request sent, no attempt spent — any result that is not exactly 8 decimal digits. The confirmation code SHALL
NOT appear in any string the dashboard offers for copying. The request identifier
MAY appear in such a string, as it is not a credential. The approve verb SHALL
accept no identifier and resolve to the only pending request when exactly one
exists; with none, or with more than one, it SHALL list them and exit non-zero
rather than choose. It SHALL accept an optional
device name and, for a request that arrived as a network knock, an optional access
tier, with the same defaults the dashboard applies.

These verbs SHALL authenticate with the host-only local credential and SHALL carry
no new authority: they SHALL be refused on a host where that credential cannot be
read, and SHALL be refused — before any request is sent — when no per-request
credential can be derived from it for the server's configured address (for
example when the server is configured to bind a host name rather than an address);
they SHALL NOT send a request without a credential. They SHALL NOT create, replace or repair that credential as a side effect, and
SHALL be subject to the same per-request attempt budget, lockout,
expiry and single-use semantics as every other approval entry point. They SHALL
produce the same server-side audit record as an approval made from the dashboard.
The CLI SHALL report a server that is not running, a request that no longer
exists, a mismatched code with the attempts left, and a locked-out or expired
request as distinct, non-zero outcomes, each with its own message. The exit status
SHALL identify the outcome class: `2` for a usage or input error (unknown verb or
option, malformed code, no code on input, no single pending request to resolve),
`1` when the local credential or configuration prevents sending a request, `3`
when the server refuses the request (mismatch, lockout, expiry, unknown request,
credential rejected), and `4` when the server cannot be reached or does not answer
in time.

#### Scenario: Approve from the host shell

- **GIVEN** a pending request on a server running on this host and the 8-digit code displayed on the requesting device
- **WHEN** the operator lists the pending requests and approves one with that code
- **THEN** the device SHALL be paired exactly as if approved from the dashboard
- **AND** the server SHALL record the approval in its pairing audit log

#### Scenario: Listing never reveals the confirmation code

- **WHEN** the operator lists pending requests
- **THEN** no output SHALL contain the confirmation code of any request

#### Scenario: Wrong code spends one shared attempt

- **GIVEN** a pending request with 5 attempts
- **WHEN** the operator supplies a non-matching code from the CLI and then opens the dashboard dialog
- **THEN** the CLI SHALL report the mismatch and the attempts left
- **AND** the dialog SHALL show the same remaining count, because both entry points share one budget

#### Scenario: Lockout from the CLI is terminal

- **WHEN** the attempt budget for a request is exhausted through CLI attempts
- **THEN** further CLI approvals of that request SHALL be refused as locked out and the device SHALL NOT be paired

#### Scenario: No local credential, no approval

- **GIVEN** a host where the local credential cannot be read
- **WHEN** the operator attempts a CLI approval
- **THEN** the CLI SHALL refuse with a non-zero outcome naming the missing credential
- **AND** no approval request SHALL be sent
- **AND** no local-credential file or directory SHALL have been created

#### Scenario: Server bound to a host name

- **GIVEN** the local credential is readable but the server's configured bind host is a host name, so no per-request credential can be derived
- **WHEN** the operator attempts any CLI pairing verb
- **THEN** the CLI SHALL exit non-zero with a message naming the configured host as the cause
- **AND** no request SHALL be sent to the server

#### Scenario: Shell on a different OS than the server

- **GIVEN** the CLI runs under a different operating system or user account than the server process, so it resolves a different local-credential path (for example a WSL shell against a server running on Windows)
- **WHEN** the operator attempts a CLI approval
- **THEN** the CLI SHALL refuse as it does for a missing credential, naming the path it looked in
- **AND** it SHALL NOT create a credential there

#### Scenario: Expired request reported, not silently dropped

- **WHEN** the operator approves a request whose pairing code has already expired
- **THEN** the CLI SHALL report the expiry as a non-zero outcome and pair no device

#### Scenario: Deny from the host shell

- **WHEN** the operator denies a pending request from the CLI
- **THEN** the request SHALL be consumed exactly as a dashboard deny, and an open dashboard dialog for it SHALL close as handled elsewhere

#### Scenario: Untrusted device text cannot drive the terminal

- **GIVEN** a pending request whose self-reported name and User-Agent contain terminal escape sequences, C1 controls, a bidirectional override and a zero-width character, and whose User-Agent exceeds the field maximum
- **WHEN** the operator lists pending requests
- **THEN** the printed fields SHALL contain none of those characters
- **AND** each printed field SHALL be no longer than its maximum, measured in code points

#### Scenario: Truncation never splits a character

- **GIVEN** a User-Agent of 119 ASCII characters followed by `😀` and further text, with a 120 code-point maximum
- **WHEN** the operator lists pending requests
- **THEN** the printed User-Agent SHALL be exactly 120 code points, ending with `…`
- **AND** it SHALL contain no unpaired surrogate

#### Scenario: Malformed code is refused locally

- **WHEN** the operator supplies `1234567`, `123456789` or `12a45678` as the confirmation code
- **THEN** the CLI SHALL exit `2` naming the expected 8 digits
- **AND** no request SHALL be sent and no attempt SHALL be spent
- **WHEN** the operator supplies `1234 5678` or `1234-5678`
- **THEN** the CLI SHALL send `12345678`

#### Scenario: Code piped on standard input

- **GIVEN** standard input is not a terminal and no code option is given
- **WHEN** standard input carries `12345678` followed by a newline
- **THEN** the CLI SHALL submit `12345678`
- **WHEN** standard input ends with no bytes or carries an empty first line
- **THEN** the CLI SHALL exit `2` and send no approval request

#### Scenario: Exit status identifies the outcome class

- **WHEN** a CLI pairing verb ends on a usage error, a missing credential, a server refusal, or an unreachable server
- **THEN** it SHALL exit `2`, `1`, `3` or `4` respectively
- **AND** a mismatch, a lockout, an expiry and an unknown request SHALL each print a distinct message under exit `3`
