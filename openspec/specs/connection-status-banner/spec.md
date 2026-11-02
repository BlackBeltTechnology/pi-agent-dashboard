## Purpose
Surface active-connection state above the UI shell, distinguishing a transport outage (offline/retrying) from a network-guard policy denial (network not allowed).

## Requirements

### Requirement: Visible disconnection banner
The dashboard SHALL display a persistent banner above the main UI shell whenever the active client WebSocket has been in a non-`OPEN` state continuously for more than 3 seconds, unless the "Network not allowed" surface or the local-proof remedy is shown for the active server, which then replaces it. The banner SHALL clearly identify the targeted server and indicate that retries are in progress.

#### Scenario: Banner appears after threshold
- **WHEN** the active WebSocket has been in a non-`OPEN` state for more than 3 seconds
- **AND** no network denial or local-proof state is known for the active server
- **THEN** a banner SHALL be rendered above the main UI shell
- **AND** the banner SHALL contain the text "Disconnected from <host>. Retrying…" where `<host>` is the currently-targeted server

#### Scenario: Network denial replaces the disconnection banner
- **WHEN** the active WebSocket has been in a non-`OPEN` state for more than 3 seconds
- **AND** the network-denial probe reports a denial (403 or `networkAccess` health verdict) for the active server
- **THEN** the "Network not allowed" surface SHALL be shown instead of "Disconnected from <host>. Retrying…" and no "Server offline" indicator SHALL be shown

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
The dashboard SHALL render a **distinct "Network not allowed" presentation**, separate from the "Disconnected / Retrying" offline banner, when a failure is caused by the server's network guard rather than by a transport-level outage. A guard denial is either an HTTP 403 with `error: "network_not_allowed"`, or a `200` from `GET {apiBase}/api/health` whose body carries `networkAccess.error === "network_not_allowed"` (the server's verdict for this caller). A `200` carrying `localProof: "required"` takes precedence and keeps its local-proof presentation. The health probe SHALL go through the client's credentialed fetch path, which attaches only the bearer of the probed server's own origin, so a paired browser is judged as itself and no bearer reaches another origin. The two states SHALL be visually and textually distinguishable so the user can tell "the server is up but my network is not permitted" from "the server is offline".

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
- **WHEN** the active WebSocket is in a non-`OPEN` state for more than 3 seconds due to a transport failure (no 403 policy denial and no `networkAccess` health verdict)
- **THEN** the existing "Disconnected from <host>. Retrying…" banner SHALL be shown
- **AND** the "Network not allowed" surface SHALL NOT be shown

#### Scenario: Health-reachable but browse-denied is not "offline"
- **WHEN** `/api/health` returns 200 for the served origin but a guarded endpoint (e.g. `/api/browse`) returns 403 `network_not_allowed`
- **THEN** the dashboard SHALL NOT label the server "offline"
- **AND** SHALL render the "Network not allowed" surface for the denied action

#### Scenario: Unpaired remote browser with authentication disabled sees Request access
- **GIVEN** a server in `network.trustMode: "pair"` with `pairing.acceptLanRequests: true` and no sign-in method (no OAuth provider, passkeys off), serving the page itself (the active server is the page origin)
- **AND** a remote browser with no device cookie, bearer or session
- **WHEN** the browser loads the dashboard and its WebSocket is refused
- **THEN** `/api/health` SHALL answer `200` with `networkAccess: { error: "network_not_allowed", hint }`
- **AND** the dashboard SHALL render the "Network not allowed" surface with the Request access action, not "Disconnected from <host>. Retrying…" or an Offline chip
- **AND** activating Request access SHALL navigate the same browsing context to `/pair?request`

#### Scenario: Paired browser on a cross-origin server sees offline during an outage
- **GIVEN** a browser paired with an active server that is not the page origin, holding that server's bearer
- **WHEN** the WebSocket drops for a transport reason and the health probe is answered
- **THEN** the probe SHALL carry that server's own bearer (and no other origin's credential), the answer SHALL NOT carry `networkAccess`, and the "Disconnected / Retrying" banner SHALL be shown

#### Scenario: Local-proof field wins
- **WHEN** `/api/health` answers `200` with `localProof: "required"`
- **THEN** the client SHALL show the `pi-dashboard open` remedy, not the Request access surface

#### Scenario: Server with a sign-in method keeps its login redirect
- **GIVEN** a server with a sign-in method configured (OAuth provider or passkeys), in `network.trustMode: "pair"`
- **WHEN** an unpaired, signed-out remote browser loads the dashboard and its WebSocket reports `auth_required`
- **THEN** the redirect to the sign-in page SHALL behave exactly as before this change
