## MODIFIED Requirements

### Requirement: Settings panel known servers section
The Settings panel SHALL include a "Servers" section displaying all known servers with their label, host:port, and a remove button. Add, remove and update actions SHALL be offered only when the viewer holds an operator credential; otherwise the list SHALL be shown read-only with a text note that an operator credential is needed to change servers. An entry whose identity is pinned (`fingerprint` set) SHALL show a "Verified" severity-success pill with an icon whose accessible description says the identity was verified when the server was added (a pin persists while the server is offline); an unpinned entry SHALL show no identity pill. Removing a server SHALL take two steps — Remove, then Confirm remove or Cancel — matching the Users revoke flow. A failed list load SHALL render an error with a Retry action instead of the empty-list text, and a failed remove or move acceptance SHALL render an error next to the affected entry.

#### Scenario: Display known servers
- **WHEN** the user opens Settings
- **THEN** the Servers section SHALL show each known server with its label (or hostname if no label), host:port, and a remove (✕) button whose accessible name names the server and its host:port

#### Scenario: Remove a known server from UI
- **WHEN** the user activates the remove button on a known server and then activates Confirm remove
- **THEN** the system SHALL call `DELETE /api/known-servers` and remove the entry from the displayed list
- **AND** activating Cancel instead SHALL leave the entry and SHALL NOT call `DELETE /api/known-servers`

#### Scenario: Add server manually
- **WHEN** the user clicks "Add server" in the known servers section
- **THEN** an inline form SHALL appear with visibly labelled host, port, and label fields
- **AND** submitting SHALL call `POST /api/known-servers` and add the entry to the displayed list

#### Scenario: Non-operator viewer sees a read-only list
- **WHEN** a viewer whose list response carries `canManage: false` opens the Servers section
- **THEN** the known servers SHALL be listed without add, remove or update controls
- **AND** a text note SHALL say that an operator credential is needed to change servers

#### Scenario: Pinned entry is marked verified
- **WHEN** the list contains one entry with a fingerprint and one without
- **THEN** only the first SHALL show the "Verified" pill

#### Scenario: Load failure is not shown as an empty list
- **WHEN** the known-servers list request fails
- **THEN** the section SHALL show an error with a Retry action, and the "No remote servers saved" text SHALL NOT be rendered

#### Scenario: Failed remove is reported on the row
- **WHEN** `DELETE /api/known-servers` fails after Confirm remove
- **THEN** the entry SHALL stay listed with an error message next to it

### Requirement: Settings panel network discovery section
The Settings panel SHALL include a "Network Discovery" sub-section with a scan button, discovered server results, a diagnostic empty-state, and an inline manual-add form. A discovered server SHALL be shown with its advertised display name when it has one, and SHALL be recognised as already known when its fingerprint and port match a known entry or its host:port matches a known entry. Local and remote discovered servers SHALL use the same Local and Remote identity pills as the server selector. Every input SHALL have a visible label, and every confirm or cancel control SHALL have an accessible name that names the server.

#### Scenario: Trigger network scan
- **WHEN** the user clicks "Scan network"
- **THEN** the system SHALL call `POST /api/discover-servers` and display results
- **AND** a polite live region SHALL announce the scan state ("Scanning…", the number of dashboards found, or none found)

#### Scenario: Add discovered server with label
- **WHEN** the user clicks "Add" on a discovered server
- **THEN** a label input SHALL appear, pre-filled with the server's advertised display name when present, otherwise its hostname, and editable by the user
- **AND** confirming SHALL call `POST /api/known-servers` with the host, port, user-entered label, and the advertised fingerprint as a hint
- **AND** a failed confirm SHALL show an error next to that server instead of being ignored

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

### Requirement: Surface scan errors in the UI
The Network Discovery section SHALL display the scan error message to the user when `POST /api/discover-servers` rejects (network error, server unreachable, etc.) instead of silently treating the failure as an empty result.

#### Scenario: Scan throws
- **WHEN** the user clicks "Scan network" and `discoverServers()` rejects with `Error("connection refused")`
- **THEN** the section SHALL render `Scan failed: connection refused` in a severity-error callout with a Retry action, beneath the scan button
- **AND** SHALL still mark the scan as completed so the empty-state diagnostic also appears

## ADDED Requirements

### Requirement: Known-servers and discovery sections conform to the UI contract
The known-servers and network-discovery settings sections SHALL paint only through theme tokens and semantic families (no Tailwind palette class, hex or `rgba(` literal); information text SHALL NOT use `--text-muted`; and both sections SHALL pass the contrast, size and focus probes in `{base,dark}`, `{base,light}` and `{nord,dark}` in these states: loading; load error; empty list; populated list (verified, unverified, moved); read-only viewer; remove confirmation; row error; add form, valid and invalid; scan idle; scanning; scan error; empty scan result with the manual-add form; and scan results (new, already added, updated, adding).

#### Scenario: Every state passes the probes
- **WHEN** the capture spec installs each listed state and probes both sections in every listed theme
- **THEN** every contrast, size and focus failure list is empty
