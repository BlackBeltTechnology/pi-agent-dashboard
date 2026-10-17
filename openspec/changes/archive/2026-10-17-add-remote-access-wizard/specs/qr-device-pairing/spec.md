## MODIFIED Requirements

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
