## Purpose
Surface active-connection state above the UI shell, distinguishing a transport outage (offline/retrying) from a network-guard policy denial (network not allowed).

## Requirements

### Requirement: Visible disconnection banner
The dashboard SHALL display a persistent banner above the main UI shell whenever the active client WebSocket has been in a non-`OPEN` state continuously for more than 3 seconds. The banner SHALL clearly identify the targeted server and indicate that retries are in progress.

#### Scenario: Banner appears after threshold
- **WHEN** the active WebSocket has been in a non-`OPEN` state for more than 3 seconds
- **THEN** a banner SHALL be rendered above the main UI shell
- **AND** the banner SHALL contain the text "Disconnected from <host>. Retrying…" where `<host>` is the currently-targeted server

#### Scenario: Banner hidden when connected
- **WHEN** the active WebSocket is in the `OPEN` state
- **THEN** no banner SHALL be visible

#### Scenario: Brief disconnects do not show banner
- **WHEN** the active WebSocket is in a non-`OPEN` state for less than 3 seconds and then returns to `OPEN`
- **THEN** the banner SHALL NOT be displayed at any point during the brief disconnect

#### Scenario: Banner does not appear during staging switch
- **WHEN** a staging WebSocket switch is in progress and the live WebSocket is still `OPEN`
- **THEN** the banner SHALL NOT be displayed, because no disconnection has occurred

### Requirement: Switch-server action in banner
The disconnection banner SHALL provide a visible affordance that lets the user open the server selector dropdown without relying on the header icon.

#### Scenario: Open server selector from banner
- **WHEN** the banner is visible and the user clicks the banner's "Switch server" action
- **THEN** the server selector dropdown SHALL open
- **AND** the user SHALL be able to choose a different server to switch to

### Requirement: Banner hidden immediately on successful reconnect
The banner SHALL disappear as soon as the active WebSocket transitions back to `OPEN`, with no additional delay or fade-out that could leave stale messaging visible.

#### Scenario: Banner hides on reconnect
- **WHEN** the active WebSocket transitions from a non-`OPEN` state back to `OPEN`
- **THEN** the banner SHALL be hidden in the next render cycle

### Requirement: Network-not-allowed state distinct from offline
The dashboard SHALL render a **distinct "Network not allowed" presentation**, separate from the "Disconnected / Retrying" offline banner, when a failure is caused by the server's network guard (HTTP 403 with `error: "network_not_allowed"`) rather than by a transport-level outage. The two states SHALL be visually and textually distinguishable so the user can tell "the server is up but my network is not permitted" from "the server is offline".

The "Network not allowed" presentation SHALL include the server-supplied `hint` (remedy), the sign-in flow when the server offers one, and the existing "Settings → Servers" action as a secondary affordance (for switching servers). Neither the hint nor any affordance SHALL direct the user to add their network to a trusted-networks setting. When the knock is refused, the presentation SHALL show the refusal reason the server returned.

It SHALL additionally offer a "Request access" action, presented as the surface's most prominent action, that targets the server that denied the request: when that server is the page's own origin it SHALL navigate to `/pair?request`; when it is another server (the active server differs from the page origin) it SHALL open that server's own `/pair?request` in a new browsing context without an opener reference. The presentation SHALL use the warning severity tokens (not a fixed colour palette), SHALL carry an icon with its title text, and SHALL wrap rather than truncate the hint on narrow viewports.

#### Scenario: Guard 403 shows Network not allowed
- **WHEN** a guarded API call or probe to the active server returns HTTP 403 with `error: "network_not_allowed"`
- **THEN** the dashboard SHALL render a "Network not allowed" surface (not "Disconnected from <host>. Retrying…")
- **AND** the surface SHALL display the server's `hint` text
- **AND** the surface SHALL offer a Request access affordance as its primary action
- **AND** the surface SHALL keep the Settings → Servers affordance as a secondary action

#### Scenario: Denied browser can request access
- **WHEN** a browser's API call is refused with `network_not_allowed`
- **THEN** the "Network not allowed" surface SHALL show a "Request access" action
- **AND** when the denying server is the page's origin, activating it SHALL open `/pair?request` on the same origin

#### Scenario: Remote denying server gets its own request page
- **GIVEN** the page is served by `http://192.168.16.31:8000` and the active server is `http://192.168.16.204:8000`
- **WHEN** the active server refuses with `network_not_allowed` and the user activates Request access
- **THEN** a new browsing context SHALL open `http://192.168.16.204:8000/pair?request`

#### Scenario: Hint wraps on a phone
- **WHEN** the "Network not allowed" surface renders at a 375 px viewport with a hint longer than one line
- **THEN** the full hint SHALL be visible (wrapped), not truncated

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
