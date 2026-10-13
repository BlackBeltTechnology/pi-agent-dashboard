## MODIFIED Requirements

### Requirement: Network-not-allowed state distinct from offline
The dashboard SHALL render a **distinct "Network not allowed" presentation**, separate from the "Disconnected / Retrying" offline banner, when a failure is caused by the server's network guard (HTTP 403 with `error: "network_not_allowed"`) rather than by a transport-level outage. The two states SHALL be visually and textually distinguishable so the user can tell "the server is up but my network is not permitted" from "the server is offline".

The "Network not allowed" presentation SHALL include the server-supplied `hint` (remedy) and a visible affordance linking to Settings → Servers (where `trustedNetworks` is configured) and/or the sign-in flow.

It SHALL additionally offer a "Request access" action, presented as the surface's most prominent action, that targets the server that denied the request: when that server is the page's own origin it SHALL navigate to `/pair?request`; when it is another server (the active server differs from the page origin) it SHALL open that server's own `/pair?request` in a new browsing context without an opener reference. The presentation SHALL use the warning severity tokens (not a fixed colour palette), SHALL carry an icon with its title text, and SHALL wrap rather than truncate the hint on narrow viewports.

#### Scenario: Guard 403 shows Network not allowed
- **WHEN** a guarded API call or probe to the active server returns HTTP 403 with `error: "network_not_allowed"`
- **THEN** the dashboard SHALL render a "Network not allowed" surface (not "Disconnected from <host>. Retrying…")
- **AND** the surface SHALL display the server's `hint` text
- **AND** the surface SHALL offer a link/affordance to Settings → Servers

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

#### Scenario: Transport outage still shows offline banner
- **WHEN** the active WebSocket is in a non-`OPEN` state for more than 3 seconds due to a transport failure (no 403 policy denial)
- **THEN** the existing "Disconnected from <host>. Retrying…" banner SHALL be shown
- **AND** the "Network not allowed" surface SHALL NOT be shown

#### Scenario: Health-reachable but browse-denied is not "offline"
- **WHEN** `/api/health` returns 200 for the served origin but a guarded endpoint (e.g. `/api/browse`) returns 403 `network_not_allowed`
- **THEN** the dashboard SHALL NOT label the server "offline"
- **AND** SHALL render the "Network not allowed" surface for the denied action
