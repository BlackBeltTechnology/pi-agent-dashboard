## MODIFIED Requirements

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

## ADDED Requirements

### Requirement: Server selector conforms to the UI contract and shows state in text
The header server selector and its dropdown SHALL paint only through theme tokens and semantic families (no Tailwind palette class, hex or `rgba(` literal). The trigger SHALL show the connection state as a word ("Connected" or "Offline") beside an `aria-hidden` status dot, and SHALL include it in its accessible name. Each entry's state (current, checking, available, unreachable, network not allowed, blocked in this browser, name not found, moved) SHALL be a severity pill with text — never only a colour or dot — at 12 px or larger, because it sits inside an interactive item.

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
