## MODIFIED Requirements

### Requirement: Settings panel network discovery section
The Settings panel SHALL include a "Network Discovery" sub-section with a scan button, discovered server results, a diagnostic empty-state, and an inline manual-add form. A discovered server SHALL be shown with its advertised display name when it has one, and SHALL be recognised as already known when its fingerprint and port match a known entry or its host:port matches a known entry. Local and remote discovered servers SHALL use the same Local and Remote identity pills as the server selector. Every input SHALL have a visible label, and every confirm or cancel control SHALL have an accessible name that names the server. A remote discovered server SHALL offer a "Connect" action whose accessible name names the server; it SHALL open that server's own `/pair?request` landing (`http://<host>:<port>/pair?request`, IPv6 literals bracketed) in a new browsing context without an opener reference. A local discovered server SHALL NOT offer Connect.

#### Scenario: Trigger network scan
- **WHEN** the user clicks "Scan network"
- **THEN** the system SHALL call `POST /api/discover-servers` and display results
- **AND** a polite live region SHALL announce the scan state ("Scanning…", the number of dashboards found, or none found)

#### Scenario: Add discovered server with label
- **WHEN** the user clicks "Add" on a discovered server
- **THEN** a label input SHALL appear, pre-filled with the server's advertised display name when present, otherwise its hostname, and editable by the user
- **AND** confirming SHALL call `POST /api/known-servers` with the host, port, user-entered label, and the advertised fingerprint as a hint
- **AND** a failed confirm SHALL show an error next to that server instead of being ignored

#### Scenario: Connect opens the peer's request landing
- **WHEN** the user activates "Connect" on remote discovered server `home-imac` at `192.168.16.204:8000`
- **THEN** a new browsing context SHALL open `http://192.168.16.204:8000/pair?request` with no opener reference

#### Scenario: Connect brackets IPv6 hosts
- **WHEN** the user activates "Connect" on a remote discovered server at `fd12::4` port `8000`
- **THEN** the opened URL SHALL be `http://[fd12::4]:8000/pair?request`

#### Scenario: Local server offers no Connect
- **WHEN** a discovered server is local
- **THEN** its row SHALL NOT show a Connect action

#### Scenario: Discovered server already known
- **WHEN** a discovered server's host:port matches an entry in known servers
- **THEN** it SHALL show as "Already added" instead of an "Add" button

#### Scenario: Renamed server recognised by identity
- **WHEN** a discovered server's fingerprint and port match a known entry whose host differs
- **THEN** it SHALL show as "Already added" instead of an "Add" button

#### Scenario: Empty result shows diagnostic block
- **WHEN** the scan completes and discovers zero servers
- **THEN** the section SHALL render a diagnostic block whose headline states that no dashboards were found via mDNS
- **AND** the common reasons mDNS discovery fails — Wi-Fi AP/client isolation, mesh routers or Wi-Fi extenders dropping multicast, different VLANs/subnets, an active VPN capturing the default route, and the macOS firewall blocking inbound traffic on the dashboard port — SHALL be listed inside a "Why does discovery fail?" disclosure, collapsed by default
- **AND** the diagnostic block SHALL include an inline manual-add form that is visible without expanding the disclosure

#### Scenario: Manual-add via free-form input
- **WHEN** the diagnostic empty-state is visible and the user types `192.168.16.202:8000` (or `http://192.168.16.202:8000`) into the host input, optionally types a label, and presses Enter or clicks Add
- **THEN** the section SHALL call `parseHostInput(...)` to extract `{host, port}`
- **AND** call `POST /api/known-servers` with the parsed host, port, and label
- **AND** clear the input on success
- **AND** call the `onServerAdded` callback so the parent re-fetches known servers

#### Scenario: Manual-add with invalid input
- **WHEN** the user submits the manual-add form with an unparseable string
- **THEN** the section SHALL display an inline validation error (`Enter a host like 192.168.1.42:8000 or http://office-mac.local:8000`) linked to the input by `aria-describedby`, with the input marked `aria-invalid`
- **AND** SHALL NOT call `POST /api/known-servers`

#### Scenario: Manual-add with duplicate host:port
- **WHEN** the user submits a host:port that already exists in `knownServers`
- **THEN** the section SHALL display an inline message naming the host:port and noting it is already added
- **AND** SHALL NOT call `POST /api/known-servers`
