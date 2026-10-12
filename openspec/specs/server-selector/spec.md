## Purpose
Dashboard-header dropdown to view, probe, and switch between known servers without losing the current session context.

## Requirements

### Requirement: Server selector in dashboard header
The dashboard header SHALL include a server selector dropdown showing known servers (persisted) plus, **only when the page is served from a loopback origin**, a `localhost` "Local" entry. The `localhost` "Local" row SHALL be seeded ONLY when `window.location.hostname` is one of `localhost`, `127.0.0.1`, or `::1`. When the dashboard is served from a remote host, the selector SHALL NOT seed a `localhost` entry — the current (served) origin is the operative server — so the selector never shows a phantom "localhost:<port> is unreachable" row that probes the browser's own machine.

Availability probing SHALL run once per dropdown open — not on mount, not on a timer, not while the dropdown is closed. Entries whose probes report unreachable SHALL be rendered with reduced opacity, a `disabled` attribute, and a `cursor-not-allowed` affordance; the selector SHALL NOT call `onSwitch` for unreachable entries. A probe that fails the network guard (HTTP 403 `network_not_allowed`) SHALL be rendered as a distinct "Network not allowed" state — NOT "Unreachable" — since the server is reachable but the client's network/auth is not permitted.

#### Scenario: Loopback origin seeds localhost
- **WHEN** the page origin hostname is `localhost` or `127.0.0.1`
- **THEN** the selector SHALL seed the `localhost` "Local" entry first, then known servers

#### Scenario: Remote origin does NOT seed localhost
- **WHEN** the page is served from a non-loopback host (e.g. `pennyroyal.lan`)
- **THEN** the selector SHALL NOT seed a `localhost` entry
- **AND** no "localhost:<port> is unreachable" row SHALL appear
- **AND** the served origin SHALL be the operative current entry

#### Scenario: 403 renders as Network not allowed, not Unreachable
- **WHEN** an entry's probe (or a guarded API call to it) returns HTTP 403 with `error: "network_not_allowed"`
- **THEN** that entry SHALL render a "Network not allowed" indicator distinct from the "Unreachable" indicator
- **AND** a transport failure or non-403 probe failure SHALL still render "Unreachable"

### Requirement: Server switching
Selecting a different server in the dropdown SHALL perform a transactional switch: a staging WebSocket connection is opened to the target while the current ("live") connection remains active, and the switch is committed only after the staging connection reaches the `OPEN` state. If the staging connection fails or times out, the switch is aborted and the live connection is preserved with no state loss.

#### Scenario: Switch to reachable remote server
- **WHEN** the user selects a reachable remote server from the dropdown
- **THEN** the dashboard SHALL open a staging WebSocket to the selected server's address while keeping the current WebSocket open
- **AND** upon the staging WebSocket reaching `OPEN`, the dashboard SHALL close the previous WebSocket, swap in-memory session state, and re-subscribe to sessions from the new server
- **AND** only after a successful swap SHALL the new server address be persisted to `localStorage`

#### Scenario: Switch back to localhost when reachable
- **WHEN** the user selects the localhost entry after being connected to a remote server, and localhost is reachable
- **THEN** the dashboard SHALL perform the same transactional switch and reload session data from localhost

#### Scenario: Switch to unreachable server
- **WHEN** the user selects a server whose staging WebSocket does not reach `OPEN` within 5 seconds, or is rejected by the server
- **THEN** the dashboard SHALL close the staging WebSocket and keep the previous connection active
- **AND** in-memory session state SHALL NOT be cleared
- **AND** `localStorage` SHALL NOT be updated
- **AND** a toast SHALL be displayed with the message "Couldn't reach <host>"

#### Scenario: Click during in-flight switch
- **WHEN** a staging switch is already in progress and the user clicks another entry
- **THEN** the second click SHALL be ignored until the first staging attempt resolves (success or failure)

#### Scenario: Staging progress indicator
- **WHEN** a staging switch is in progress
- **THEN** the clicked dropdown entry SHALL display an inline progress indicator
- **AND** the overall connection banner SHALL NOT be shown because the live connection is still open

#### Scenario: Selected server becomes unreachable after switch
- **WHEN** the currently connected server becomes unreachable after a successful switch
- **THEN** the selector SHALL show a disconnected indicator
- **AND** the dashboard SHALL attempt reconnection with existing backoff logic

### Requirement: Persist last-used server
The last-used server address SHALL be persisted in `localStorage` so the dashboard reconnects to it on next launch, but persistence SHALL occur only after a successful `OPEN` of the new connection — never at click time.

#### Scenario: Client persists in localStorage on success
- **WHEN** a staging WebSocket reaches `OPEN` and the switch is committed
- **THEN** the server address SHALL be saved in `localStorage` under `pi-dashboard-last-server`

#### Scenario: Client does not persist on failure
- **WHEN** a staging WebSocket fails to open or times out
- **THEN** the `localStorage` value SHALL remain unchanged from its previous state

#### Scenario: Client reconnects to last-used server
- **WHEN** the dashboard loads and `localStorage` has a saved server address
- **THEN** the dashboard SHALL attempt to connect to the saved server first
- **AND** fall back to localhost discovery if the saved server is unreachable

### Requirement: Server discovery via WebSocket message
The server SHALL broadcast discovered peer servers to connected browsers for the network discovery UI in Settings, not for the header dropdown.

#### Scenario: Server sends peer list
- **WHEN** a browser connects to the dashboard server
- **THEN** the server SHALL send a `servers_discovered` message with mDNS-discovered peers

#### Scenario: Server sends peer update
- **WHEN** a new peer server appears or disappears on the network
- **THEN** the server SHALL broadcast a `servers_updated` message to all connected browsers

### Requirement: Cross-origin CORS-blocked probe is distinct from Unreachable
When an availability probe from the browser fails with no readable response (the transport `.catch()` path), the selector SHALL consult the dashboard server's reachability probe for that entry and render the cause it reports, instead of inferring the cause from the host's address class. The CORS-blocked indicator SHALL be shown only when the dashboard server reaches the target but the browser cannot. The existing HTTP 403 `network_not_allowed` → "Network not allowed" state is preserved.

#### Scenario: LAN host with a blocked probe shows an allowlist hint
- **WHEN** an entry whose host is a private-LAN address (RFC-1918, CGNAT, link-local, or an mDNS `.local` name) is probed cross-origin AND the browser probe throws with no readable response
- **THEN** the allowlist hint SHALL be rendered only if the server-side probe reports `reachable` for that entry
- **AND** the host's address class alone SHALL NOT select the CORS-blocked indicator

#### Scenario: Server reaches the target but the browser cannot
- **WHEN** the browser probe throws with no readable response AND the server-side probe reports `reachable`
- **THEN** the entry SHALL render a distinct indicator stating the server is reachable from the dashboard but not from this browser (CORS or network), with a hint that the remote may need to allowlist this origin
- **AND** the entry SHALL be disabled

#### Scenario: Stale hostname is named as such
- **WHEN** the browser probe throws AND the server-side probe reports `name-not-resolved`
- **THEN** the entry SHALL render "Name not found" with a hint that the server may have been renamed
- **AND** it SHALL NOT render the CORS-blocked indicator

#### Scenario: Moved server offers an update
- **WHEN** the server-side probe reports `name-not-resolved` for an entry and the known-servers listing carries a move suggestion for it
- **THEN** the entry SHALL show "Moved to" with the suggested address and an Update action that accepts the suggestion
- **AND** switching to the entry SHALL remain disabled until the entry has been updated and probes available

#### Scenario: Genuine outage stays Unreachable
- **WHEN** the browser probe throws AND the server-side probe reports `refused`, `timeout`, or `error`
- **THEN** the entry SHALL render "Unreachable"

#### Scenario: Server-side probe unavailable
- **WHEN** the browser probe throws AND the server-side probe request itself fails or is refused
- **THEN** the entry SHALL render "Unreachable"

#### Scenario: Unavailable states block switching
- **WHEN** an entry renders any state other than available
- **THEN** the entry SHALL be disabled for switching

#### Scenario: Existing states unchanged
- **WHEN** a probe returns HTTP 403 with `error: "network_not_allowed"`
- **THEN** the entry SHALL render "Network not allowed"
