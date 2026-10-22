## Purpose
Dashboard-header dropdown to view, probe, and switch between known servers without losing the current session context.

## Requirements

### Requirement: Server selector in dashboard header
The dashboard header SHALL include a server selector dropdown showing known servers (persisted) plus, **only when the page is served from a loopback origin**, a `localhost` "Local" entry. The `localhost` "Local" row SHALL be seeded ONLY when `window.location.hostname` is one of `localhost`, `127.0.0.1`, or `::1`. When the dashboard is served from a remote host, the selector SHALL NOT seed a `localhost` entry — the current (served) origin is the operative server — so the selector never shows a phantom "localhost:<port> is unreachable" row that probes the browser's own machine.

Availability probing SHALL run once per dropdown open — not on mount, not on a timer, not while the dropdown is closed. While an entry's probe is in flight the entry SHALL show a "Checking…" state. Entries whose probes report any state other than available SHALL be rendered `aria-disabled="true"` — focusable but not activatable — with the reason as visible text in the entry, referenced by `aria-describedby`; the reason SHALL NOT be carried only by a `title` tooltip, and the selector SHALL NOT call `onSwitch` for such entries. A probe that fails the network guard (HTTP 403 `network_not_allowed`) SHALL be rendered as a distinct "Network not allowed" state — NOT "Unreachable" — since the server is reachable but the client's network/auth is not permitted.

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

#### Scenario: Probe in flight is visible
- **WHEN** the dropdown opens and an entry's probe has not settled
- **THEN** that entry SHALL show "Checking…" until its result arrives

#### Scenario: Blocked entry is focusable but not switchable
- **WHEN** keyboard focus moves onto an unreachable entry and the user presses Enter
- **THEN** the entry SHALL be announced as disabled, its reason text SHALL be visible and referenced by `aria-describedby`, and `onSwitch` SHALL NOT be called

### Requirement: Server switching
Outside the Electron app's local dashboard window (in a browser, or in an Electron window that cannot open server windows), selecting a different server in the dropdown SHALL perform a transactional switch: a staging WebSocket connection is opened to the target while the current ("live") connection remains active, and the switch is committed only after the staging connection reaches the `OPEN` state. If the staging connection fails or times out, the switch is aborted and the live connection is preserved with no state loss.

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
The last-used server address SHALL be persisted in `localStorage` so the dashboard reconnects to it on next launch, but persistence SHALL occur only after a successful `OPEN` of the new connection — never at click time. When the dashboard runs in the Electron app's main window on the local dashboard origin and the app offers the open-server-window capability, the dashboard SHALL NOT reconnect to a saved remote server on load; it SHALL connect to its own origin and SHALL ignore (but not delete) a saved remote address.

#### Scenario: Client persists in localStorage on success
- **WHEN** a staging WebSocket reaches `OPEN` and the switch is committed
- **THEN** the server address SHALL be saved in `localStorage` under `pi-dashboard-last-server`

#### Scenario: Client does not persist on failure
- **WHEN** a staging WebSocket fails to open or times out
- **THEN** the `localStorage` value SHALL remain unchanged from its previous state

#### Scenario: Client reconnects to last-used server
- **WHEN** the dashboard loads outside the Electron local window and `localStorage` has a saved server address
- **THEN** the dashboard SHALL attempt to connect to the saved server first
- **AND** fall back to localhost discovery if the saved server is unreachable

#### Scenario: Electron local window ignores a saved remote
- **GIVEN** the Electron main window on `http://localhost:8000` offers the open-server-window capability and `pi-dashboard-last-server` holds `192.168.16.204:8000` from an earlier in-page switch
- **WHEN** the dashboard loads
- **THEN** it SHALL connect to `localhost:8000` and the saved `pi-dashboard-last-server` value SHALL be left unchanged

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
- **AND** the entry SHALL be disabled for switching

#### Scenario: Stale hostname is named as such
- **WHEN** the browser probe throws AND the server-side probe reports `name-not-resolved`
- **THEN** the entry SHALL render "Name not found" with a hint that the server may have been renamed
- **AND** it SHALL NOT render the CORS-blocked indicator

#### Scenario: Moved server offers an update
- **WHEN** the server-side probe reports `name-not-resolved` for an entry and the known-servers listing carries a move suggestion for it
- **THEN** the entry SHALL show a "Moved" state with the suggested address, and a separate menu item labelled "Update <name> to <address>" SHALL accept the suggestion
- **AND** if the accept is refused (for example, the viewer lacks an operator credential), the menu SHALL show the refusal as text instead of ignoring it
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

### Requirement: Server selector conforms to the UI contract and shows state in text
The header server selector and its dropdown SHALL paint only through theme tokens and semantic families (no Tailwind palette class, hex or `rgba(` literal). The trigger is the sidebar header's connection chip: its visible content (server-kind glyph with status-dot badge, server name, offline cue) SHALL follow `sidebar-header` "Connection chip surfaces state that needs attention", its decorative glyphs and status dot SHALL be `aria-hidden`, and its accessible name SHALL include the connection state ("connected" or "offline"). Each entry's state (current, checking, available, unreachable, network not allowed, blocked in this browser, name not found, moved) SHALL be a severity pill with text — never only a colour or dot — at 12 px or larger, because it sits inside an interactive item.

#### Scenario: State is not carried by colour alone
- **WHEN** the dropdown lists one available, one unreachable and one CORS-blocked server, and the dashboard is connected
- **THEN** each entry shows a different text state pill, and the trigger's accessible name includes "connected"

#### Scenario: Probes pass in every theme
- **WHEN** the capture spec probes the open menu element (`role="menu"`, located from the page, not from the trigger's subtree) in `{base,dark}`, `{base,light}` and `{nord,dark}`
- **THEN** every contrast, size and focus failure list is empty

### Requirement: Server selector follows the APG menu button pattern
The trigger SHALL carry `aria-haspopup="menu"` and `aria-expanded`. The dropdown SHALL be a `role="menu"` in which each server is a `menuitemradio` (`aria-checked` on the current server), "Manage servers…" is a `menuitem`, and an accepted-move action is its own `menuitem`. Enter, Space or ArrowDown on the trigger SHALL open the menu and move focus to the first item; ArrowUp, ArrowDown, Home and End SHALL move focus within the menu; Enter or Space SHALL activate the focused item; Escape SHALL close the menu and return focus to the trigger; Tab SHALL close the menu and move focus to the next focusable element after the trigger. Blocked items stay inside the menu's roving focus, so the page's Tab order is unchanged. Focus SHALL be managed this way even though the menu renders in a portal. The `data-unreachable`, `data-denied`, `data-cors-blocked` and `data-name-not-resolved` attributes SHALL stay on the server items.

#### Scenario: Keyboard-only switching
- **WHEN** the user focuses the trigger, presses Enter, moves to an available server with ArrowDown and presses Enter
- **THEN** that server becomes active with no pointer input, and focus returns to the trigger

#### Scenario: Escape closes and restores focus
- **WHEN** the menu is open and the user presses Escape
- **THEN** the menu closes and the trigger has focus

### Requirement: Electron opens a server window instead of switching in-page
When the dashboard runs in the Electron app's main window on the local dashboard origin and the app offers the open-server-window capability, selecting an available remote server entry SHALL ask the app to open (or focus) that server's own window — or, when the app holds no usable credential for it, to start pairing with it — passing only the entry's host and port, and SHALL NOT open a staging WebSocket, swap session state, or update the persisted last-used server. The current window SHALL stay on the local dashboard. Selecting the localhost "Local" entry SHALL do nothing beyond closing the dropdown. While the request is in flight the entry SHALL show the inline progress indicator; when the app reports a failure (identity mismatch, unreachable, pairing refused or stopped) the selector SHALL show a toast with the reason in text. Entries that are not available (unreachable, network not allowed, blocked in this browser, name not found, moved, or still checking) SHALL stay non-activatable exactly as in the header requirement and SHALL NOT trigger the request. When the capability is absent, the transactional in-page switch SHALL apply.

#### Scenario: Selecting a remote opens its window
- **GIVEN** the dashboard runs in the Electron main window on `http://localhost:8000`
- **WHEN** the user selects the reachable entry `home-imac` (`192.168.16.204:8000`)
- **THEN** the app SHALL be asked to open the server window for `192.168.16.204:8000`
- **AND** no staging WebSocket SHALL be opened and `localStorage` SHALL NOT be updated
- **AND** the current window SHALL keep showing the local dashboard

#### Scenario: Failure is reported in text
- **WHEN** the app reports that `home-imac` answered with a different identity
- **THEN** a toast SHALL state the identity mismatch for `home-imac` and no window SHALL open

#### Scenario: Unavailable entry does not open a window
- **WHEN** the user presses Enter on an entry showing "Unreachable" in the Electron main window
- **THEN** the app SHALL NOT be asked to open a server window

#### Scenario: Network-not-allowed entry pairs from the Connect window
- **GIVEN** an unpaired remote entry shows "Network not allowed" in the Electron main window
- **WHEN** the user presses Enter on it
- **THEN** the app SHALL NOT be asked to open a window; the user pairs it from "Connect to Remote Dashboard"

#### Scenario: Browser keeps the in-page switch
- **GIVEN** the dashboard runs in a regular browser tab
- **WHEN** the user selects a reachable remote entry
- **THEN** the transactional in-page switch SHALL run
