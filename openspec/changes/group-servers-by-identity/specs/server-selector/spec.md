## MODIFIED Requirements

### Requirement: Server selector in dashboard header
The dashboard header SHALL include a server selector dropdown showing one entry per server identity — saved, discovered and (in the Electron app) paired servers merged by fingerprint, each with a chip per route — plus, **only when the page is served from a loopback origin**, a `localhost` "Local" entry. The `localhost` "Local" row SHALL be seeded ONLY when `window.location.hostname` is one of `localhost`, `127.0.0.1`, or `::1`. When the dashboard is served from a remote host, the selector SHALL NOT seed a `localhost` entry — the current (served) origin is the operative server — so the selector never shows a phantom "localhost:<port> is unreachable" row that probes the browser's own machine.

Availability probing SHALL run once per dropdown open — not on mount, not on a timer, not while the dropdown is closed — and SHALL check every route of every entry with the identity challenge plus an access check (see the server-identity-routes capability). While an entry's checks are in flight the entry SHALL show a "Checking…" state; an entry's state SHALL come from its best proven route, and a route refused for proving a different identity SHALL be shown as refused without disabling an entry that has another usable route. Entries whose probes report any state other than available SHALL be rendered `aria-disabled="true"` — focusable but not activatable — with the reason as visible text in the entry, referenced by `aria-describedby`; the reason SHALL NOT be carried only by a `title` tooltip, and the selector SHALL NOT call `onSwitch` for such entries. An entry for which this device holds no credential SHALL offer its pair action (server-identity-routes) as a separate `menuitem` directly below the entry; the entry's own activation rules are unchanged. A probe that fails the network guard (HTTP 403 `network_not_allowed`) SHALL be rendered as a distinct "Network not allowed" state — NOT "Unreachable" — since the server is reachable but the client's network/auth is not permitted.

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

#### Scenario: One row per identity
- **WHEN** a server is saved at its LAN address, discovered at its `.local` name and has a tunnel route, all proving the same fingerprint
- **THEN** the dropdown SHALL show one entry with three route chips

#### Scenario: Refused route is shown, not used
- **WHEN** one route of an entry proves a different fingerprint
- **THEN** its chip SHALL read "different identity" in text and switching SHALL use another proven route or be disabled when there is none

#### Scenario: Unpaired entry offers its pair action
- **WHEN** the Electron app lists a discovered server with no keyring entry
- **THEN** a "Request access…" menu item SHALL appear below that entry

#### Scenario: Browser pair action navigates to the peer
- **WHEN** a browser lists a server whose only route is the on-link `http://192.168.16.77:8000` and activates its "Request access…" menu item
- **THEN** a new browsing context SHALL open `http://192.168.16.77:8000/pair?request` with no opener reference and no proof request SHALL precede it

### Requirement: Cross-origin CORS-blocked probe is distinct from Unreachable
When a route check from the browser (the identity challenge or the access check) fails with no readable response (the transport `.catch()` path), the selector SHALL consult the dashboard server's reachability probe for that entry and render the cause it reports, instead of inferring the cause from the host's address class. The CORS-blocked indicator SHALL be shown only when the dashboard server reaches the target but the browser cannot. The existing HTTP 403 `network_not_allowed` → "Network not allowed" state is preserved. A fingerprint the dashboard server reports for a route the browser cannot reach MAY place that route under its entry, but SHALL NOT make the route usable from this browser.

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

#### Scenario: Server-proven route is not usable from a blocked browser
- **WHEN** the browser cannot reach a route and the server-side probe reports `reachable` with fingerprint F
- **THEN** the route MAY be listed under the entry holding F, SHALL render "Blocked in this browser", and switching to it SHALL stay disabled

### Requirement: Server selector conforms to the UI contract and shows state in text
The header server selector and its dropdown SHALL paint only through theme tokens and semantic families (no Tailwind palette class, hex or `rgba(` literal). The trigger SHALL show the connection state as a word ("Connected" or "Offline") beside an `aria-hidden` status dot, and SHALL include it in its accessible name. Each entry's state (current, checking, available, unreachable, network not allowed, blocked in this browser, name not found, moved, can't prove identity, different identity) SHALL be a severity pill with text — never only a colour or dot — at 12 px or larger, because it sits inside an interactive item. Each route chip SHALL state its proof outcome and latency as text.

#### Scenario: State is not carried by colour alone
- **WHEN** the dropdown lists one available, one unreachable and one CORS-blocked server, and the dashboard is connected
- **THEN** each entry shows a different text state pill, and the trigger's accessible name includes "connected"

#### Scenario: Probes pass in every theme
- **WHEN** the capture spec probes the open menu element (`role="menu"`, located from the page, not from the trigger's subtree) in `{base,dark}`, `{base,light}` and `{nord,dark}`
- **THEN** every contrast, size and focus failure list is empty

#### Scenario: Route chips state their proof in text
- **WHEN** an entry has one proven route at 4 ms and one route that proves a different identity
- **THEN** the first chip SHALL read its kind and "4 ms" and the second SHALL read its kind and "different identity", neither by colour alone

### Requirement: Server selector follows the APG menu button pattern
The trigger SHALL carry `aria-haspopup="menu"` and `aria-expanded`. The dropdown SHALL be a `role="menu"` in which each server is a `menuitemradio` (`aria-checked` on the current server), "Manage servers…" is a `menuitem`, and an accepted-move action is its own `menuitem`, and a pair action is its own `menuitem`. Enter, Space or ArrowDown on the trigger SHALL open the menu and move focus to the first item; ArrowUp, ArrowDown, Home and End SHALL move focus within the menu; Enter or Space SHALL activate the focused item; Escape SHALL close the menu and return focus to the trigger; Tab SHALL close the menu and move focus to the next focusable element after the trigger. Blocked items stay inside the menu's roving focus, so the page's Tab order is unchanged. Focus SHALL be managed this way even though the menu renders in a portal. The `data-unreachable`, `data-denied`, `data-cors-blocked` and `data-name-not-resolved` attributes SHALL stay on the server items.

#### Scenario: Keyboard-only switching
- **WHEN** the user focuses the trigger, presses Enter, moves to an available server with ArrowDown and presses Enter
- **THEN** that server becomes active with no pointer input, and focus returns to the trigger

#### Scenario: Escape closes and restores focus
- **WHEN** the menu is open and the user presses Escape
- **THEN** the menu closes and the trigger has focus

### Requirement: Electron opens a server window instead of switching in-page
When the dashboard runs in the Electron app's main window on the local dashboard origin and the app offers the open-server-window capability, selecting an available remote server entry SHALL ask the app to open (or focus) that server's own window — or, when the app holds no usable credential for it, to start pairing with it — passing only the host and port of the entry's best proven route, and SHALL NOT open a staging WebSocket, swap session state, or update the persisted last-used server. The current window SHALL stay on the local dashboard. Selecting the localhost "Local" entry SHALL do nothing beyond closing the dropdown. While the request is in flight the entry SHALL show the inline progress indicator; when the app reports a failure (identity mismatch, unreachable, pairing refused or stopped) the selector SHALL show a toast with the reason in text. Entries that are not available (unreachable, network not allowed, blocked in this browser, name not found, moved, or still checking) SHALL stay non-activatable exactly as in the header requirement and SHALL NOT trigger the request. When the capability is absent, the transactional in-page switch SHALL apply.

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
- **THEN** the app SHALL NOT be asked to open a window
- **AND** the user SHALL be able to pair it from the entry's pair action (its own menu item) or from "Connect to Remote Dashboard"

#### Scenario: Browser keeps the in-page switch
- **GIVEN** the dashboard runs in a regular browser tab
- **WHEN** the user selects a reachable remote entry
- **THEN** the transactional in-page switch SHALL run

### Requirement: Server discovery via WebSocket message
The server SHALL broadcast discovered peer servers to connected browsers as the discovery source of the server list: each peer becomes a route of the identity it advertises (or its own entry when it advertises none) in Settings ▸ Servers and in the header selector.

#### Scenario: Server sends peer list
- **WHEN** a browser connects to the dashboard server
- **THEN** the server SHALL send a `servers_discovered` message with mDNS-discovered peers

#### Scenario: Server sends peer update
- **WHEN** a new peer server appears or disappears on the network
- **THEN** the server SHALL broadcast a `servers_updated` message to all connected browsers
