# known-servers Specification

## Purpose

Lets a browser reach dashboard servers other than the one it was loaded from. Persists a list of known servers in config, exposes REST endpoints to list, add, and remove them plus an on-demand mDNS scan, and defines the Settings surfaces for both the known-server list and network discovery — including free-form host input parsing and surfacing scan errors rather than failing silently.

## Requirements

### Requirement: Known servers persisted in config
The system SHALL persist a list of known remote servers in the `knownServers` array in `config.json`. Each entry SHALL have `host` (string), `port` (number), `label` (optional string), `addedAt` (ISO timestamp), and `fingerprint` (optional string — the server identity pinned for this entry). Localhost SHALL always be implicitly available and not stored in the list. At most one entry SHALL carry a given combination of fingerprint and port.

#### Scenario: Empty known servers by default
- **WHEN** no `knownServers` field exists in config
- **THEN** the system SHALL treat it as an empty array
- **AND** localhost SHALL still be available as a server

#### Scenario: Known servers loaded at startup
- **WHEN** the config contains `knownServers` entries
- **THEN** the system SHALL include them in the server list alongside localhost

#### Scenario: Entry without fingerprint remains valid
- **WHEN** a persisted entry has no `fingerprint` field
- **THEN** the system SHALL load and use it exactly as before

#### Scenario: Duplicate identities collapse on load
- **WHEN** the persisted list contains two entries with the same fingerprint and port
- **THEN** the system SHALL keep the first and drop the later one

#### Scenario: Fingerprint survives reload and rewrite
- **WHEN** an entry pinned to a fingerprint is loaded, and another entry is then added or removed
- **THEN** the pinned entry SHALL still carry its fingerprint after the write and the next load

### Requirement: REST API to list known servers
The server SHALL expose `GET /api/known-servers` returning the current known servers list from config. Localhost is handled implicitly by the client. Each entry SHALL carry its pinned `fingerprint` when it has one and, when a verified move suggestion exists for it, `movedTo` with the suggested host and port. The response SHALL also state whether the caller holds an operator credential (`canManage`), evaluated with the same operator guard as the mutating routes and without side effects.

#### Scenario: List with no known servers
- **WHEN** `GET /api/known-servers` is called and config has no `knownServers`
- **THEN** the response SHALL return `{ success: true, data: [] }`

#### Scenario: List with known servers
- **WHEN** `GET /api/known-servers` is called and config has entries
- **THEN** the response SHALL return `{ success: true, data: [...entries] }` with all fields

#### Scenario: List states whether the caller may manage
- **WHEN** a caller admitted only by network trust lists known servers
- **THEN** the response SHALL carry `canManage: false`
- **AND** an operator caller SHALL receive `canManage: true`

#### Scenario: List carries a move suggestion
- **WHEN** an entry has a verified move suggestion
- **THEN** that entry SHALL carry `movedTo` with the suggested host and port

### Requirement: REST API to add a known server
The server SHALL expose `POST /api/known-servers` accepting `{ host, port, label?, fingerprint? }` to add a server to the persisted list. The route SHALL require an operator credential as accepted by the server's existing operator guard (login session, local-proof cookie, local token, or a genuinely-local request); a caller admitted only by network trust or a paired-device credential SHALL be refused. Before writing, the server SHALL challenge the identity of the server at `host:port` and SHALL pin only a proven fingerprint; `fingerprint` in the request is a hint and SHALL NOT be persisted unless proven. An add SHALL never clear or replace a fingerprint already pinned on an entry.

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

#### Scenario: Operator add pins the proven identity
- **WHEN** an operator adds a server whose identity challenge proves fingerprint F
- **THEN** the persisted entry SHALL carry F

#### Scenario: Failed challenge stores no fingerprint
- **WHEN** an operator adds a server whose identity challenge fails or cannot be reached
- **THEN** the entry SHALL be persisted without a fingerprint

#### Scenario: Unproven hint is not stored
- **WHEN** an operator adds a server with a `fingerprint` hint that the identity challenge does not prove
- **THEN** the hint SHALL NOT be persisted

#### Scenario: Adding a known identity at a working address is refused
- **WHEN** an operator adds a server whose proven fingerprint and port belong to an existing entry at another host, and that entry's stored address still proves the fingerprint
- **THEN** the server SHALL respond `409` with error `already_known` naming the existing entry
- **AND** SHALL NOT modify any entry

#### Scenario: Adding an already-pinned identity updates instead of duplicating
- **WHEN** an operator adds a server whose proven fingerprint and port belong to an existing entry at another host, and that entry's stored address no longer proves the fingerprint
- **THEN** the existing entry's host SHALL be updated, its label replaced only if a non-empty label was supplied, its `addedAt` kept, and no second entry SHALL be created
- **AND** the response SHALL indicate that an existing entry was updated

#### Scenario: Re-adding a pinned entry while its server is down keeps the pin
- **WHEN** an operator re-adds a host:port whose entry is pinned to fingerprint F and the identity challenge fails
- **THEN** the entry SHALL still carry F after the write

#### Scenario: Changed identity at a pinned address is refused
- **WHEN** an operator adds `host:port` whose existing entry is pinned to fingerprint F and the challenge proves a different fingerprint G
- **THEN** the server SHALL respond `409` with error `identity_changed` naming the expected and proven fingerprints
- **AND** SHALL NOT modify the entry

#### Scenario: Non-operator add refused
- **WHEN** a caller admitted only by network trust or a paired-device credential calls `POST /api/known-servers`
- **THEN** the server SHALL refuse the request, SHALL NOT contact the target, and SHALL NOT modify `knownServers`

### Requirement: REST API to remove a known server
The server SHALL expose `DELETE /api/known-servers` accepting `{ host, port }` to remove a server from the persisted list. The route SHALL require an operator credential as accepted by the server's existing operator guard; a caller admitted only by network trust or a paired-device credential SHALL be refused.

#### Scenario: Remove an existing server
- **WHEN** `DELETE /api/known-servers` is called with a matching host:port
- **THEN** the server SHALL remove the entry from config and return `{ success: true }`

#### Scenario: Remove non-existent server
- **WHEN** `DELETE /api/known-servers` is called with a host:port not in the list
- **THEN** the server SHALL return `{ success: true }` (idempotent)

#### Scenario: Non-operator remove refused
- **WHEN** a caller admitted only by network trust or a paired-device credential calls `DELETE /api/known-servers`
- **THEN** the server SHALL refuse the request and SHALL NOT modify `knownServers`

### Requirement: REST API for on-demand mDNS scan
The server SHALL expose `POST /api/discover-servers` that returns currently discovered mDNS peers.

#### Scenario: Scan with peers available
- **WHEN** `POST /api/discover-servers` is called and mDNS has discovered peers
- **THEN** the response SHALL return `{ success: true, data: [...peers] }` with host, port, version, isLocal, pid fields
- **AND** each peer that advertises an identity SHALL also carry `fingerprint` and `name`

#### Scenario: Scan with no peers
- **WHEN** `POST /api/discover-servers` is called and no peers are discovered
- **THEN** the response SHALL return `{ success: true, data: [] }`

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
- **THEN** the section SHALL render `Scan failed: connection refused` in a severity-error callout with a Retry action, beneath the scan button
- **AND** SHALL still mark the scan as completed so the empty-state diagnostic also appears

### Requirement: Unpinned reachable entry is backfilled
The server SHALL pin the fingerprint of a known entry that has none when the server at that entry's stored address proves an identity through the identity challenge. A fingerprint read from an mDNS advertisement alone SHALL NOT be persisted.

#### Scenario: Reachable unpinned entry is backfilled
- **WHEN** the server-side probe reports a known entry without a fingerprint as reachable and its identity challenge at the stored address proves fingerprint F
- **THEN** the entry SHALL gain F

#### Scenario: Backfill does not create a duplicate identity
- **WHEN** backfill proves fingerprint F for an entry while another entry already holds F on the same port
- **THEN** the backfilled entry SHALL be kept and the other entry merged into it and removed
- **AND** no two entries SHALL hold F on that port

#### Scenario: Advertisement alone pins nothing
- **WHEN** a discovered peer advertises fingerprint F at the address of an unpinned known entry and no identity challenge has succeeded
- **THEN** the entry SHALL remain without a fingerprint

### Requirement: Verified move suggestion for a renamed server
When a discovered peer advertises the fingerprint and port of a pinned known entry at a different host, and the entry's stored address no longer proves that fingerprint while the peer's address does, the server SHALL record a move suggestion for that entry and return it with the entry in the known-servers listing. The server SHALL NOT change the persisted entry on its own and SHALL NOT persist the suggestion. The server SHALL challenge a discovered address only when it is on a subnet of one of the server's own interfaces and is not a loopback, link-local, unspecified or multicast address. Recording and withdrawing a suggestion SHALL be logged. A suggestion SHALL be withdrawn when the stored address proves the fingerprint again, when the peer disappears, or when it has not been re-verified for 10 minutes.

#### Scenario: Renamed server yields a suggestion
- **WHEN** a known entry pinned to fingerprint F stores `home-imac-75112.local:8000`, that address no longer proves F, and a peer advertising F on port 8000 is discovered at another host and proves F
- **THEN** the known-servers listing SHALL return the entry unchanged, with a move suggestion naming the discovered host and port

#### Scenario: Working stored address yields no suggestion
- **WHEN** a pinned entry's stored address still proves its fingerprint and the same server is also discovered at another address
- **THEN** no move suggestion SHALL be recorded for that entry

#### Scenario: Unproven advertisement yields no suggestion
- **WHEN** a peer advertises fingerprint F but fails the identity challenge at its discovered address
- **THEN** no move suggestion SHALL be recorded and the entry SHALL remain unchanged

#### Scenario: Unpinned entry gets no suggestion
- **WHEN** a discovered peer's address differs from a known entry that has no fingerprint
- **THEN** no move suggestion SHALL be recorded for that entry

#### Scenario: Off-link advertised address is not contacted
- **WHEN** a peer advertising a pinned fingerprint and port lists only addresses outside the server's own subnets, or loopback, link-local, unspecified or multicast addresses
- **THEN** the server SHALL NOT send an identity challenge to them and SHALL record no suggestion

#### Scenario: Suggestion is not persisted
- **WHEN** a move suggestion exists and the server restarts
- **THEN** the persisted entry SHALL be unchanged and carry no suggestion

#### Scenario: Suggestion withdrawn when the server answers again
- **WHEN** an entry has a move suggestion and its stored address proves the fingerprint again
- **THEN** the suggestion SHALL no longer be returned

### Requirement: Operator accepts a move suggestion
The server SHALL expose an operator-only action that accepts an entry's move suggestion. Before writing, the server SHALL re-verify that the stored address still fails to prove the fingerprint and that the suggested address still proves it. On success it SHALL update the entry's host and port, preserving label, fingerprint and `addedAt`, and SHALL log the fingerprint with the old and new address. The Settings known-servers section and the server selector SHALL offer this action on an entry that has a suggestion.

#### Scenario: Accepting a verified suggestion moves the entry
- **WHEN** an operator accepts the suggestion for an entry pinned to F and both re-verifications hold
- **THEN** the entry SHALL be stored with the suggested host and port, with its label, fingerprint and `addedAt` unchanged

#### Scenario: Stale suggestion is refused on accept
- **WHEN** an operator accepts a suggestion but the suggested address no longer proves F, or the stored address proves F again
- **THEN** the server SHALL refuse the action and SHALL NOT modify the entry

#### Scenario: Non-operator accept refused
- **WHEN** a caller without an operator credential attempts to accept a suggestion
- **THEN** the server SHALL refuse the action and SHALL NOT modify the entry

#### Scenario: Accept on a removed entry
- **WHEN** an entry is removed while an accept for it is being verified
- **THEN** the server SHALL NOT recreate the entry

#### Scenario: Suggestion shown in Settings
- **WHEN** the Settings known-servers section lists an entry that has a move suggestion
- **THEN** it SHALL show the suggested address and an Update action that performs the accept

### Requirement: Server-side reachability probe of known servers
The server SHALL expose a probe, available only to callers holding an operator credential as accepted by the server's existing operator guard, that for a host and port matching a persisted known-server entry reports the server's own view of reachability as one of `reachable`, `name-not-resolved`, `refused`, `timeout`, or `error`. The probe SHALL refuse targets that are not persisted known-server entries, SHALL request only that entry's health endpoint over HTTP without following redirects, and SHALL run at most one probe per entry at a time.

#### Scenario: Unknown target refused
- **WHEN** the probe is requested for a host and port not present in `knownServers`
- **THEN** the server SHALL refuse the request and SHALL NOT contact that target

#### Scenario: Non-operator caller refused
- **WHEN** the probe is requested by a caller without an operator credential
- **THEN** the server SHALL refuse the request and SHALL NOT contact the target

#### Scenario: Unresolvable name reported
- **WHEN** the probe target's hostname does not resolve, even if the negative answer takes longer than the HTTP timeout
- **THEN** the result SHALL be `name-not-resolved`

#### Scenario: Concurrent probes of one entry collapse
- **WHEN** two probes for the same entry arrive while one is in flight, spelled with different case, a trailing dot, or IPv6 brackets
- **THEN** the server SHALL contact the target at most once for them

#### Scenario: Reachable server reported
- **WHEN** the probe target answers its health endpoint with a successful dashboard health response
- **THEN** the result SHALL be `reachable`

#### Scenario: Non-dashboard answer is not reachable
- **WHEN** the probe target answers with a redirect, an error status, or a body that is not a dashboard health response
- **THEN** the result SHALL be `error`

#### Scenario: Redirect is not followed
- **WHEN** the probe target answers with an HTTP redirect
- **THEN** the server SHALL NOT request the redirect location

### Requirement: Known-servers and discovery sections conform to the UI contract
The known-servers and network-discovery settings sections SHALL paint only through theme tokens and semantic families (no Tailwind palette class, hex or `rgba(` literal); information text SHALL NOT use `--text-muted`; and both sections SHALL pass the contrast, size and focus probes in `{base,dark}`, `{base,light}` and `{nord,dark}` in these states: loading; load error; empty list; populated list (verified, unverified, moved); read-only viewer; remove confirmation; row error; add form, valid and invalid; scan idle; scanning; scan error; empty scan result with the manual-add form; and scan results (new, already added, updated, adding).

#### Scenario: Every state passes the probes
- **WHEN** the capture spec installs each listed state and probes both sections in every listed theme
- **THEN** every contrast, size and focus failure list is empty
