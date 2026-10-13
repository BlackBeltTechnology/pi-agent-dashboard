## MODIFIED Requirements

### Requirement: Network-not-allowed state distinct from offline
The dashboard SHALL render a **distinct "Network not allowed" presentation**, separate from the "Disconnected / Retrying" offline banner, when a failure is caused by the server's network guard (HTTP 403 with `error: "network_not_allowed"`) rather than by a transport-level outage. The two states SHALL be visually and textually distinguishable so the user can tell "the server is up but my network is not permitted" from "the server is offline".

The "Network not allowed" presentation SHALL include the server-supplied `hint` (remedy) and a primary **Request access** affordance that starts the device-initiated pairing flow of the `lan-knock-pairing` capability against the denied server, plus the sign-in flow when the server offers one, and the existing "Settings → Servers" action as a secondary affordance (for switching servers). Neither the hint nor any affordance SHALL direct the user to add their network to a trusted-networks setting. When the knock is refused, the presentation SHALL show the refusal reason the server returned.

#### Scenario: Guard 403 shows Network not allowed
- **WHEN** a guarded API call or probe to the active server returns HTTP 403 with `error: "network_not_allowed"`
- **THEN** the dashboard SHALL render a "Network not allowed" surface (not "Disconnected from <host>. Retrying…")
- **AND** the surface SHALL display the server's `hint` text
- **AND** the surface SHALL offer a Request access affordance as its primary action
- **AND** the surface SHALL keep the Settings → Servers affordance as a secondary action

#### Scenario: Request access starts pairing
- **WHEN** the user activates Request access on the "Network not allowed" surface
- **THEN** the dashboard SHALL start the knock flow against the denied server and show the confirm code to type on that server

#### Scenario: Refused knock is explained
- **WHEN** the knock is refused (e.g. LAN requests disabled, address not eligible, rate limited)
- **THEN** the surface SHALL show the refusal reason and SHALL NOT suggest trusting the network

#### Scenario: Transport outage still shows offline banner
- **WHEN** the active WebSocket is in a non-`OPEN` state for more than 3 seconds due to a transport failure (no 403 policy denial)
- **THEN** the existing "Disconnected from <host>. Retrying…" banner SHALL be shown
- **AND** the "Network not allowed" surface SHALL NOT be shown

#### Scenario: Health-reachable but browse-denied is not "offline"
- **WHEN** `/api/health` returns 200 for the served origin but a guarded endpoint (e.g. `/api/browse`) returns 403 `network_not_allowed`
- **THEN** the dashboard SHALL NOT label the server "offline"
- **AND** SHALL render the "Network not allowed" surface for the denied action
