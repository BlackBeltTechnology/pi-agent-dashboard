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
- **THEN** a new browsing context SHALL open `http://192.168.16.77:8000/pair?request` (followed by a companion fragment only where the server-identity-routes pair action allows one) with no opener reference and no proof request SHALL precede it
