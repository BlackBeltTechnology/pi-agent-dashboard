# known-servers Specification

## Purpose

Lets a browser reach dashboard servers other than the one it was loaded from. Persists a list of known servers in config, exposes REST endpoints to list, add, and remove them plus an on-demand mDNS scan, and defines the Settings surfaces for both the known-server list and network discovery — including free-form host input parsing and surfacing scan errors rather than failing silently.

## Requirements

### Requirement: Known servers persisted in config
The system SHALL persist a list of known remote servers in the `knownServers` array in `config.json`. Each entry SHALL have `host` (string), `port` (number), `label` (optional string), and `addedAt` (ISO timestamp). Localhost SHALL always be implicitly available and not stored in the list.

#### Scenario: Empty known servers by default
- **WHEN** no `knownServers` field exists in config
- **THEN** the system SHALL treat it as an empty array
- **AND** localhost SHALL still be available as a server

#### Scenario: Known servers loaded at startup
- **WHEN** the config contains `knownServers` entries
- **THEN** the system SHALL include them in the server list alongside localhost

### Requirement: REST API to list known servers
The server SHALL expose `GET /api/known-servers` returning the current known servers list from config. Localhost is handled implicitly by the client.

#### Scenario: List with no known servers
- **WHEN** `GET /api/known-servers` is called and config has no `knownServers`
- **THEN** the response SHALL return `{ success: true, data: [] }`

#### Scenario: List with known servers
- **WHEN** `GET /api/known-servers` is called and config has entries
- **THEN** the response SHALL return `{ success: true, data: [...entries] }` with all fields

### Requirement: REST API to add a known server
The server SHALL expose `POST /api/known-servers` accepting `{ host, port, label? }` to add a server to the persisted list.

#### Scenario: Add a new server
- **WHEN** `POST /api/known-servers` is called with `{ host: "office-mac", port: 8000, label: "Office" }`
- **THEN** the server SHALL append the entry to `knownServers` in config with an `addedAt` timestamp
- **AND** return `{ success: true }`

#### Scenario: Add duplicate server
- **WHEN** `POST /api/known-servers` is called with a host:port that already exists in the list
- **THEN** the server SHALL update the label and return `{ success: true }`
- **AND** SHALL NOT create a duplicate entry

#### Scenario: Add with empty label
- **WHEN** `POST /api/known-servers` is called without a label
- **THEN** the server SHALL store the entry without a label field

### Requirement: REST API to remove a known server
The server SHALL expose `DELETE /api/known-servers` accepting `{ host, port }` to remove a server from the persisted list.

#### Scenario: Remove an existing server
- **WHEN** `DELETE /api/known-servers` is called with a matching host:port
- **THEN** the server SHALL remove the entry from config and return `{ success: true }`

#### Scenario: Remove non-existent server
- **WHEN** `DELETE /api/known-servers` is called with a host:port not in the list
- **THEN** the server SHALL return `{ success: true }` (idempotent)

### Requirement: REST API for on-demand mDNS scan
The server SHALL expose `POST /api/discover-servers` that returns currently discovered mDNS peers.

#### Scenario: Scan with peers available
- **WHEN** `POST /api/discover-servers` is called and mDNS has discovered peers
- **THEN** the response SHALL return `{ success: true, data: [...peers] }` with host, port, version, isLocal, pid fields

#### Scenario: Scan with no peers
- **WHEN** `POST /api/discover-servers` is called and no peers are discovered
- **THEN** the response SHALL return `{ success: true, data: [] }`

### Requirement: Settings panel known servers section
The Settings panel SHALL include a "Servers" section displaying all known servers with their label, host:port, and a remove button.

#### Scenario: Display known servers
- **WHEN** the user opens Settings
- **THEN** the Servers section SHALL show each known server with its label (or hostname if no label), host:port, and a remove (✕) button

#### Scenario: Remove a known server from UI
- **WHEN** the user clicks the remove button on a known server
- **THEN** the system SHALL call `DELETE /api/known-servers` and remove the entry from the displayed list

#### Scenario: Add server manually
- **WHEN** the user clicks "Add server" in the known servers section
- **THEN** an inline form SHALL appear with host, port, and label fields
- **AND** submitting SHALL call `POST /api/known-servers` and add the entry to the displayed list

### Requirement: Settings panel network discovery section
The Settings panel SHALL include a "Network Discovery" sub-section with a scan button, discovered server results, a diagnostic empty-state, and an inline manual-add form.

#### Scenario: Trigger network scan
- **WHEN** the user clicks "Scan network"
- **THEN** the system SHALL call `POST /api/discover-servers` and display results

#### Scenario: Add discovered server with label
- **WHEN** the user clicks "Add" on a discovered server
- **THEN** a label input SHALL appear (pre-filled with the server's hostname)
- **AND** confirming SHALL call `POST /api/known-servers` with the host, port, and user-entered label

#### Scenario: Discovered server already known
- **WHEN** a discovered server's host:port matches an entry in known servers
- **THEN** it SHALL show as "Already added" instead of an "Add" button

#### Scenario: Empty result shows diagnostic block
- **WHEN** the scan completes and discovers zero servers
- **THEN** the section SHALL render a diagnostic block listing the common reasons mDNS discovery fails: Wi-Fi AP/client isolation, mesh routers or Wi-Fi extenders dropping multicast, different VLANs/subnets, an active VPN capturing the default route, and the macOS firewall blocking inbound traffic on the dashboard port
- **AND** the diagnostic block SHALL include an inline manual-add form

#### Scenario: Manual-add via free-form input
- **WHEN** the diagnostic empty-state is visible and the user types `192.168.16.202:8000` (or `http://192.168.16.202:8000`) into the host input, optionally types a label, and presses Enter or clicks Add
- **THEN** the section SHALL call `parseHostInput(...)` to extract `{host, port}`
- **AND** call `POST /api/known-servers` with the parsed host, port, and label
- **AND** clear the input on success
- **AND** call the `onServerAdded` callback so the parent re-fetches known servers

#### Scenario: Manual-add with invalid input
- **WHEN** the user submits the manual-add form with an unparseable string
- **THEN** the section SHALL display an inline validation error (`Enter a host like 192.168.1.42:8000 or http://office-mac.local:8000`)
- **AND** SHALL NOT call `POST /api/known-servers`

#### Scenario: Manual-add with duplicate host:port
- **WHEN** the user submits a host:port that already exists in `knownServers`
- **THEN** the section SHALL display an inline message naming the host:port and noting it is already added
- **AND** SHALL NOT call `POST /api/known-servers`

### Requirement: Free-form host input parsing
The client SHALL provide a pure helper `parseHostInput(input, defaultPort)` (`packages/client/src/lib/parse-host-input.ts`) that converts a user-supplied host string into a `{ host, port }` pair, returning `null` on invalid input. The helper accepts:

- Full URL with scheme: `http://192.168.16.202:8000` (path and trailing slash ignored)
- URL without explicit port: `http://office-mac.local` (uses `defaultPort`)
- `host:port`: `192.168.16.202:8000`
- Bare hostname: `office-mac.local` (uses `defaultPort`)
- Bracketed IPv6 with or without port: `[::1]:8000`, `[::1]`

The helper SHALL trim leading/trailing whitespace and SHALL reject:

- Empty or whitespace-only input
- Bare (un-bracketed) IPv6 strings (ambiguous with `host:port`)
- Ports outside `1..65535` or non-numeric
- Malformed URLs (`http://` with no host)

#### Scenario: Parses full URL with port
- **WHEN** `parseHostInput("http://192.168.16.202:8000")` is called
- **THEN** it SHALL return `{ host: "192.168.16.202", port: 8000 }`

#### Scenario: Parses host:port
- **WHEN** `parseHostInput("192.168.16.202:8000")` is called
- **THEN** it SHALL return `{ host: "192.168.16.202", port: 8000 }`

#### Scenario: Falls back to default port
- **WHEN** `parseHostInput("office-mac.local", 8000)` is called
- **THEN** it SHALL return `{ host: "office-mac.local", port: 8000 }`

#### Scenario: Parses bracketed IPv6
- **WHEN** `parseHostInput("[::1]:8000")` is called
- **THEN** it SHALL return `{ host: "::1", port: 8000 }`

#### Scenario: Rejects bare IPv6 (ambiguous)
- **WHEN** `parseHostInput("::1:8000")` is called
- **THEN** it SHALL return `null`

#### Scenario: Rejects invalid port
- **WHEN** `parseHostInput("host:abc")` or `parseHostInput("host:99999")` is called
- **THEN** it SHALL return `null`

#### Scenario: Rejects empty input
- **WHEN** `parseHostInput("")` or `parseHostInput("   ")` is called
- **THEN** it SHALL return `null`

### Requirement: Surface scan errors in the UI
The Network Discovery section SHALL display the scan error message to the user when `POST /api/discover-servers` rejects (network error, server unreachable, etc.) instead of silently treating the failure as an empty result.

#### Scenario: Scan throws
- **WHEN** the user clicks "Scan network" and `discoverServers()` rejects with `Error("connection refused")`
- **THEN** the section SHALL render `Scan failed: connection refused` in a red message beneath the scan button
- **AND** SHALL still mark the scan as completed so the empty-state diagnostic also appears
