## MODIFIED Requirements

### Requirement: Network discovery is a source of the Servers section
The Servers section SHALL include network discovery as one of its sources, with a scan button, a diagnostic empty-state, and an inline manual-add form; there SHALL be no separate Network Discovery list. A discovered server SHALL be shown with its advertised display name when it has one and SHALL join the card of the identity it advertises; it SHALL be recognised as already saved when its fingerprint and port match a saved entry or its host:port matches a saved route. A discovered server that advertises no fingerprint SHALL be its own card marked "identity not advertised". Local and remote discovered servers SHALL use the same Local and Remote identity pills as the server selector. Every input SHALL have a visible label, and every confirm or cancel control SHALL have an accessible name that names the server. A remote discovered server for which this device holds no credential SHALL offer the pair action defined by the server-identity-routes capability; in a browser the "Request access" action SHALL open that server's own `/pair?request` landing (`http://<host>:<port>/pair?request`, IPv6 literals bracketed) in a new browsing context without an opener reference and without any prior proof, followed by a companion fragment only where the server-identity-routes pair action allows one. A saved route that is on-link (kind `lan` or `mdns` over `http`) SHALL offer the same browser action. A local discovered server SHALL NOT offer a pair action.

#### Scenario: Trigger network scan
- **WHEN** the user clicks "Scan network"
- **THEN** the system SHALL call `POST /api/discover-servers` and display results as routes on the matching cards
- **AND** a polite live region SHALL announce the scan state ("Scanning…", the number of dashboards found, or none found)

#### Scenario: Add discovered server with label
- **WHEN** the user clicks "Add" on a discovered server that is not saved
- **THEN** a label input SHALL appear, pre-filled with the server's advertised display name when present, otherwise its hostname, and editable by the user
- **AND** confirming SHALL call `POST /api/known-servers` with the host, port, user-entered label, and the advertised fingerprint as a hint
- **AND** a failed confirm SHALL show an error next to that server instead of being ignored

#### Scenario: Request access opens the peer's request landing
- **WHEN** the user activates "Request access" on remote discovered server `home-imac` at `192.168.16.204:8000` in a browser
- **THEN** a new browsing context SHALL open `http://192.168.16.204:8000/pair?request` (plus a companion fragment only where allowed) with no opener reference

#### Scenario: Request access brackets IPv6 hosts
- **WHEN** the user activates "Request access" on a remote discovered server at `fd12::4` port `8000` in a browser
- **THEN** the opened URL SHALL begin with `http://[fd12::4]:8000/pair?request`, and any fragment SHALL follow it

#### Scenario: Local server offers no pair action
- **WHEN** a discovered server is local
- **THEN** its card SHALL NOT show a pair action

#### Scenario: Discovered server joins its identity card
- **WHEN** a discovered server advertises fingerprint F and a saved entry holds F
- **THEN** the discovered route SHALL appear in that entry's card, not as a second card

#### Scenario: Discovered server already saved
- **WHEN** a discovered server's host:port matches a saved route, or its fingerprint and port match a saved entry whose host differs
- **THEN** it SHALL show as "Already added" instead of an "Add" button

#### Scenario: Empty result shows diagnostic block
- **WHEN** the scan completes and discovers zero servers
- **THEN** the section SHALL render a diagnostic block whose headline states that no dashboards were found via mDNS
- **AND** the common reasons mDNS discovery fails — Wi-Fi AP/client isolation, mesh routers or Wi-Fi extenders dropping multicast, different VLANs/subnets, an active VPN capturing the default route, and the macOS firewall blocking inbound traffic on the dashboard port — SHALL be listed inside a "Why does discovery fail?" disclosure, collapsed by default
- **AND** the diagnostic block SHALL include an inline manual-add form that is visible without expanding the disclosure

#### Scenario: Manual-add via free-form input
- **WHEN** the diagnostic empty-state is visible and the user types `192.168.16.202:8000`, `http://192.168.16.202:8000` or `https://lab.example.org` into the address input, optionally types a label, and presses Enter or clicks Add
- **THEN** the section SHALL parse the input into host, port and scheme with `parseRouteInput` (`https` without a port means 443, `http` or no scheme without a port uses the default dashboard port 8000)
- **AND** call `POST /api/known-servers` with the parsed host, port, scheme and label
- **AND** clear the input on success
- **AND** call the `onServerAdded` callback so the parent re-fetches known servers

#### Scenario: Manual-add with invalid input
- **WHEN** the user submits the manual-add form with an unparseable string
- **THEN** the section SHALL display an inline validation error (`Enter a host like 192.168.1.42:8000 or http://office-mac.local:8000`) linked to the input by `aria-describedby`, with the input marked `aria-invalid`
- **AND** SHALL NOT call `POST /api/known-servers`

#### Scenario: Manual-add with a route that already exists
- **WHEN** the user submits a host, port and scheme that is already a saved route
- **THEN** the section SHALL display an inline message naming the address and noting it is already added
- **AND** SHALL NOT call `POST /api/known-servers`
