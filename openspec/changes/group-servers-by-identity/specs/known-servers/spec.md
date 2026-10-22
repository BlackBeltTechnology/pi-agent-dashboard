## ADDED Requirements

### Requirement: Network discovery is a source of the Servers section
The Servers section SHALL include network discovery as one of its sources, with a scan button, a diagnostic empty-state, and an inline manual-add form; there SHALL be no separate Network Discovery list. A discovered server SHALL be shown with its advertised display name when it has one and SHALL join the card of the identity it advertises; it SHALL be recognised as already saved when its fingerprint and port match a saved entry or its host:port matches a saved route. A discovered server that advertises no fingerprint SHALL be its own card marked "identity not advertised". Local and remote discovered servers SHALL use the same Local and Remote identity pills as the server selector. Every input SHALL have a visible label, and every confirm or cancel control SHALL have an accessible name that names the server. A remote discovered server for which this device holds no credential SHALL offer the pair action defined by the server-identity-routes capability; in a browser the "Request access" action SHALL open that server's own `/pair?request` landing (`http://<host>:<port>/pair?request`, IPv6 literals bracketed) in a new browsing context without an opener reference and without any prior proof. A saved route that is on-link (kind `lan` or `mdns` over `http`) SHALL offer the same browser action. A local discovered server SHALL NOT offer a pair action.

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
- **THEN** a new browsing context SHALL open `http://192.168.16.204:8000/pair?request` with no opener reference

#### Scenario: Request access brackets IPv6 hosts
- **WHEN** the user activates "Request access" on a remote discovered server at `fd12::4` port `8000` in a browser
- **THEN** the opened URL SHALL be `http://[fd12::4]:8000/pair?request`

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

## MODIFIED Requirements

### Requirement: Known servers persisted in config
The system SHALL persist a list of known remote servers in the `knownServers` array in `config.json`. Each entry SHALL describe one server identity and SHALL have `routes` (a non-empty list of `{ host, port, scheme, source }`, where `scheme` is `http` or `https` and `source` is `saved`, `mdns` or `pairing`), `addedAt` (ISO timestamp), `label` (optional string), `fingerprint` (optional string — the server identity pinned for this entry), and `host` and `port` mirroring the entry's primary route (the first `http` route, else the first route) so that readers that predate routes still load the entry; an entry SHALL always carry `host` and `port`, because those readers drop an entry that lacks them. Localhost SHALL always be implicitly available and not stored in the list. At most one entry SHALL hold a given fingerprint together with a given `http` route port. When reading, a route that is not an object with a host, a port from 1 to 65535 and scheme `http` or `https` SHALL be dropped; when no valid route remains (`routes` is empty, not an array, or all routes invalid) the entry SHALL be read as one legacy route from its `host` and `port` mirror, and an entry with neither a valid route nor a valid mirror SHALL be skipped as invalid; when the mirror disagrees with the first valid route, the routes SHALL win.

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
- **WHEN** the persisted list contains two entries with the same fingerprint and an `http` route on the same port
- **THEN** the system SHALL keep the first in stored order and append the later one's routes that it does not already hold, so no route is lost
- **AND** the survivor's label SHALL be kept, or the later entry's label used when the survivor has none

#### Scenario: Fingerprint survives reload and rewrite
- **WHEN** an entry pinned to a fingerprint is loaded, and another entry is then added or removed
- **THEN** the pinned entry SHALL still carry its fingerprint after the write and the next load

#### Scenario: Malformed routes never lose an entry
- **WHEN** a persisted entry has `routes: []`, or `routes` that is not an array, or routes with scheme `ftp`, port 0 or port 65536, and a valid `host` and `port`
- **THEN** the invalid routes SHALL be dropped and the entry SHALL load as one route from its `host` and `port` (scheme `https` for port 443)
- **AND** an entry whose valid routes disagree with its mirror SHALL load with those routes

#### Scenario: Legacy entry is read as one route
- **WHEN** a persisted entry has `host` and `port` and no `routes`
- **THEN** the system SHALL read it as an entry with one route at that host and port with source `saved`, scheme `http` (or `https` when the port is 443)

#### Scenario: Written entries stay readable by routes-unaware readers
- **WHEN** an entry with several routes is written
- **THEN** its `host` and `port` SHALL equal its primary route
- **AND** a reader that knows only `host`, `port`, `label`, `addedAt` and `fingerprint` SHALL still load the entry

#### Scenario: Https-only entry keeps a host and port mirror
- **WHEN** an entry whose only route is `https://lab.example.org` on port 443 is written
- **THEN** it SHALL carry `host: "lab.example.org"` and `port: 443` so a routes-unaware reader still lists it

#### Scenario: Legacy entry on port 443 reads as https
- **WHEN** a persisted entry has `host` and `port: 443` and no `routes` (for example after a rollback rewrote an https-only entry)
- **THEN** the system SHALL read it as one `https` route at that host, so the scheme is not lost across a rollback and re-upgrade

#### Scenario: Startup does not rewrite the file
- **WHEN** the server starts with a `knownServers` array in the previous shape and no write happens
- **THEN** the file SHALL remain byte-identical
- **AND** the first write SHALL persist every entry in the routes shape

#### Scenario: Same identity on another port stays a second entry
- **WHEN** two entries hold the same fingerprint and their `http` routes use different ports
- **THEN** both entries SHALL be kept

### Requirement: REST API to list known servers
The server SHALL expose `GET /api/known-servers` returning the current known servers list from config. Localhost is handled implicitly by the client. Each entry SHALL carry its `routes` and its pinned `fingerprint` when it has one and, when a verified move suggestion exists for its primary route, `movedTo` with the suggested host and port. The response SHALL also state whether the caller holds an operator credential (`canManage`), evaluated with the same operator guard as the mutating routes and without side effects.

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

#### Scenario: List carries routes
- **WHEN** `GET /api/known-servers` is called and an entry has an `https` tunnel route and an `http` LAN route
- **THEN** that entry SHALL list both routes with their scheme and source

### Requirement: REST API to add a known server
The server SHALL expose `POST /api/known-servers` accepting `{ host, port, scheme?, label?, fingerprint? }` (`scheme` is `http` or `https`, default `http`) to add a server, or a route of an already known server, to the persisted list. The route SHALL require an operator credential as accepted by the server's existing operator guard (login session, local-proof cookie, local token, or a genuinely-local request); a caller admitted only by network trust or a paired-device credential SHALL be refused. Before writing, the server SHALL challenge the identity of the server at that route and SHALL pin only a proven fingerprint, attaching the route to the entry that holds it under the grouping rule of the server-identity-routes capability; `fingerprint` in the request is a hint and SHALL NOT be persisted unless proven. An add SHALL never clear or replace a fingerprint already pinned on an entry.

#### Scenario: Add a new server
- **WHEN** `POST /api/known-servers` is called with `{ host: "office-mac", port: 8000, label: "Office" }`
- **THEN** the server SHALL append the entry to `knownServers` in config with one route and an `addedAt` timestamp
- **AND** return `{ success: true }`

#### Scenario: Add duplicate server
- **WHEN** `POST /api/known-servers` is called with a route (host, port and scheme) that already exists in the list
- **THEN** the server SHALL update the label and return `{ success: true }`
- **AND** SHALL NOT create a duplicate entry or route

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
This scenario keeps its historic title: the add is still refused as a second entry, but the `409 already_known` answer is retired and the route is attached instead.
- **WHEN** an operator adds a route whose proven fingerprint F belongs to an existing entry under the grouping rule, and that entry's stored route still proves F
- **THEN** the server SHALL NOT create a second entry and SHALL NOT respond `409`; the new route SHALL be added to the existing entry with source `saved`
- **AND** the response SHALL be `{ success: true, data: { updated: true } }`
- **AND** no other entry SHALL be modified

#### Scenario: Adding an already-pinned identity updates instead of duplicating
- **WHEN** an operator adds a route whose proven fingerprint F belongs to an existing entry under the grouping rule, and that entry's stored route no longer proves F
- **THEN** the new route SHALL be added to that entry, the stale route SHALL be kept, the label replaced only if a non-empty label was supplied, and `addedAt` kept, with no second entry created
- **AND** the response SHALL be `{ success: true, data: { updated: true } }`

#### Scenario: Only an attach reports updated
- **WHEN** an add creates a new entry, or re-adds a route that is already stored (refreshing its label or pin)
- **THEN** the response SHALL be `{ success: true }` without `data.updated`

#### Scenario: Re-adding a pinned entry while its server is down keeps the pin
- **WHEN** an operator re-adds a host:port whose entry is pinned to fingerprint F and the identity challenge fails
- **THEN** the entry SHALL still carry F after the write

#### Scenario: Changed identity at a pinned address is refused
- **WHEN** an operator adds a route that is already stored on an entry pinned to fingerprint F and the challenge proves a different fingerprint G
- **THEN** the server SHALL respond `409` with error `identity_changed` naming the expected and proven fingerprints
- **AND** SHALL NOT modify the entry

#### Scenario: Non-operator add refused
- **WHEN** a caller admitted only by network trust or a paired-device credential calls `POST /api/known-servers`
- **THEN** the server SHALL refuse the request, SHALL NOT contact the target, and SHALL NOT modify `knownServers`

#### Scenario: Same identity on another port starts a second entry
- **WHEN** an operator adds an `http` route whose proven fingerprint F and port differ from every `http` route of the entries holding F
- **THEN** a second entry holding F SHALL be created

#### Scenario: Add an https route
- **WHEN** an operator adds `{ host: "lab.example.org", port: 443, scheme: "https" }` and the challenge proves fingerprint F of an existing entry
- **THEN** the route SHALL be added to that entry with scheme `https`

### Requirement: REST API to remove a known server
The server SHALL expose `DELETE /api/known-servers` accepting `{ host, port, scheme? }` to remove that route from the persisted list (removing the entry when it was its last route), or `{ fingerprint }` to remove the whole entry. The route SHALL require an operator credential as accepted by the server's existing operator guard; a caller admitted only by network trust or a paired-device credential SHALL be refused.

#### Scenario: Remove an existing server
- **WHEN** `DELETE /api/known-servers` is called with a matching host:port
- **THEN** the server SHALL remove the route from config (and the entry when it was the last route) and return `{ success: true }`

#### Scenario: Remove non-existent server
- **WHEN** `DELETE /api/known-servers` is called with a host:port not in the list
- **THEN** the server SHALL return `{ success: true }` (idempotent)

#### Scenario: Non-operator remove refused
- **WHEN** a caller admitted only by network trust or a paired-device credential calls `DELETE /api/known-servers`
- **THEN** the server SHALL refuse the request and SHALL NOT modify `knownServers`

#### Scenario: Remove a whole identity
- **WHEN** `DELETE /api/known-servers` is called with `{ fingerprint }` of an entry with three routes
- **THEN** the entry and all its routes SHALL be removed

### Requirement: Settings panel known servers section
The Settings panel SHALL include a "Servers" section that lists one card per server identity, built from the saved known servers, the servers found by network discovery and, in the Electron app, the servers paired on this device. A card SHALL show the server's name (saved label, else advertised name, else host), its fingerprint in short form or "identity not advertised", whether this device is paired (per the server-identity-routes capability), and a route table with one row per route: kind, address, identity proof state, latency and where the route was learned. Add, remove and update actions SHALL be offered only when the viewer holds an operator credential; otherwise the list SHALL be shown read-only with a text note that an operator credential is needed to change servers. An entry whose identity is pinned (`fingerprint` set) SHALL show a "Verified" severity-success pill with an icon whose accessible description says the identity was verified when the server was added (a pin persists while the server is offline); an unpinned entry SHALL show no identity pill. Removing a server SHALL take two steps — Remove, then Confirm remove or Cancel — matching the Users revoke flow, and SHALL remove all its saved routes; a single saved route SHALL be removable the same two-step way. A failed list load SHALL render an error with a Retry action instead of the empty-list text, and a failed remove or move acceptance SHALL render an error next to the affected card or route.

#### Scenario: Display known servers
- **WHEN** the user opens Settings
- **THEN** the Servers section SHALL show each server as a card with its label (or hostname if no label), its routes as host:port, and a remove (✕) button whose accessible name names the server and its address

#### Scenario: Remove a known server from UI
- **WHEN** the user activates the remove button on a known server and then activates Confirm remove
- **THEN** the system SHALL call `DELETE /api/known-servers` and remove the entry from the displayed list
- **AND** activating Cancel instead SHALL leave the entry and SHALL NOT call `DELETE /api/known-servers`

#### Scenario: Add server manually
- **WHEN** the user clicks "Add server" in the Servers section
- **THEN** an inline form SHALL appear with visibly labelled address, port, and label fields, where the address MAY be a full `http://` or `https://` URL whose scheme becomes the route's scheme
- **AND** submitting SHALL call `POST /api/known-servers` and add the route to the displayed list

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

#### Scenario: Saved and discovered routes of one server show once
- **WHEN** a saved route and a discovered route prove the same fingerprint
- **THEN** the section SHALL show one card with both routes

#### Scenario: Refused route is shown on its card
- **WHEN** a route of a pinned entry proves a different fingerprint
- **THEN** its route-table row SHALL show "Different identity" with the proven fingerprint, the card SHALL say it is never used and no credential is sent there, and the other routes of the card SHALL stay usable

#### Scenario: A single route can be removed
- **WHEN** the user activates Remove on one route of a card and then Confirm remove
- **THEN** only that route SHALL be removed and the card SHALL remain while it has routes

### Requirement: Server-side reachability probe of known servers
The server SHALL expose a probe, available only to callers holding an operator credential as accepted by the server's existing operator guard, that for a host, port and optional scheme (`http` by default) matching a route of a persisted known-server entry reports the server's own view of reachability as one of `reachable`, `name-not-resolved`, `refused`, `timeout`, or `error`, and, when the status is `reachable` and the server's identity challenge at that route succeeds, the proven `fingerprint`. The probe SHALL refuse targets that are not routes of a persisted entry, SHALL request only that route's health endpoint and challenge endpoint, over the route's scheme with normal certificate verification, without following redirects and within the same 2 second timeout, and SHALL run at most one probe per route at a time.

#### Scenario: Unknown target refused
- **WHEN** the probe is requested for a host and port that are not a route of any entry in `knownServers`
- **THEN** the server SHALL refuse the request and SHALL NOT contact that target

#### Scenario: Non-operator caller refused
- **WHEN** the probe is requested by a caller without an operator credential
- **THEN** the server SHALL refuse the request and SHALL NOT contact the target

#### Scenario: Unresolvable name reported
- **WHEN** the probe target's hostname does not resolve, even if the negative answer takes longer than the HTTP timeout
- **THEN** the result SHALL be `name-not-resolved`

#### Scenario: Concurrent probes of one entry collapse
- **WHEN** two probes for the same route arrive while one is in flight, spelled with different case, a trailing dot, or IPv6 brackets
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

#### Scenario: Probe reports the proven identity
- **WHEN** the probe target answers its health endpoint and its identity challenge proves fingerprint F
- **THEN** the result SHALL be `reachable` and SHALL carry F

#### Scenario: Https route is probed over https
- **WHEN** the probe is requested for a stored `https` route
- **THEN** the server SHALL request its health endpoint over `https`

### Requirement: Known-servers and discovery sections conform to the UI contract
The Servers settings section (saved servers and network discovery) SHALL paint only through theme tokens and semantic families (no Tailwind palette class, hex or `rgba(` literal); information text SHALL NOT use `--text-muted`; and both sections SHALL pass the contrast, size and focus probes in `{base,dark}`, `{base,light}` and `{nord,dark}` in these states: loading; load error; empty list; populated list (verified, unverified, moved, a card with several routes, a refused route, a route that cannot prove identity); read-only viewer; remove confirmation; row error; add form, valid and invalid; scan idle; scanning; scan error; empty scan result with the manual-add form; and scan results (new, already added, updated, adding); and the pair action offered on a card, with the pair-with-code dialog.

#### Scenario: Every state passes the probes
- **WHEN** the capture spec installs each listed state and probes both sections in every listed theme
- **THEN** every contrast, size and focus failure list is empty

### Requirement: Unpinned reachable entry is backfilled
The server SHALL pin the fingerprint of a known entry that has none when the server at that entry's primary route proves an identity through the identity challenge, using the primary route's scheme. A fingerprint read from an mDNS advertisement alone SHALL NOT be persisted.

#### Scenario: Reachable unpinned entry is backfilled
- **WHEN** the server-side probe reports a known entry without a fingerprint as reachable and its identity challenge at the primary route proves fingerprint F
- **THEN** the entry SHALL gain F

#### Scenario: Backfill does not create a duplicate identity
- **WHEN** backfill proves fingerprint F for an entry while another entry already holds F on the same `http` port (or the backfilled route is `https` and another entry holds F)
- **THEN** the backfilled entry SHALL be the survivor, the other entry's routes that the survivor does not hold SHALL be appended to it, the survivor's label SHALL be kept (or the removed entry's label used when the survivor has none), and the other entry SHALL be removed
- **AND** no two entries SHALL hold F on that port

#### Scenario: Backfill proves an https primary route over https
- **WHEN** an unpinned entry's primary route is `https://lab.example.org`
- **THEN** backfill SHALL challenge it over `https` with normal certificate verification

#### Scenario: Advertisement alone pins nothing
- **WHEN** a discovered peer advertises fingerprint F at the address of an unpinned known entry and no identity challenge has succeeded
- **THEN** the entry SHALL remain without a fingerprint

### Requirement: Verified move suggestion for a renamed server
When a discovered peer advertises the fingerprint and port of a pinned known entry at a different host, and the entry's primary route no longer proves that fingerprint (challenged over the primary route's scheme) while the peer's address does, the server SHALL record a move suggestion for that entry and return it with the entry in the known-servers listing. The suggestion concerns the primary route only; the entry's other routes are neither challenged nor changed. The server SHALL NOT change the persisted entry on its own and SHALL NOT persist the suggestion. The server SHALL challenge a discovered address only when it is on a subnet of one of the server's own interfaces and is not a loopback, link-local, unspecified or multicast address. Recording and withdrawing a suggestion SHALL be logged. A suggestion SHALL be withdrawn when the primary route proves the fingerprint again, when the peer disappears, or when it has not been re-verified for 10 minutes.

#### Scenario: Renamed server yields a suggestion
- **WHEN** a known entry pinned to fingerprint F has primary route `home-imac-75112.local:8000`, that route no longer proves F, and a peer advertising F on port 8000 is discovered at another host and proves F
- **THEN** the known-servers listing SHALL return the entry unchanged, with a move suggestion naming the discovered host and port

#### Scenario: Working stored address yields no suggestion
- **WHEN** a pinned entry's primary route (its stored address) still proves its fingerprint and the same server is also discovered at another address
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
- **WHEN** an entry has a move suggestion and its primary route proves the fingerprint again
- **THEN** the suggestion SHALL no longer be returned

#### Scenario: Another route's state does not affect the suggestion
- **GIVEN** an entry whose primary LAN route no longer proves F and whose tunnel route does prove F
- **WHEN** a peer advertising F on the primary route's port is discovered and proves F
- **THEN** a move suggestion for the primary route SHALL still be recorded

### Requirement: Free-form host input parsing
The client SHALL provide a pure helper `parseHostInput(input, defaultPort)` (`packages/client/src/lib/util/parse-host-input.ts`) that converts a user-supplied host string into a `{ host, port }` pair, returning `null` on invalid input, and a pure helper `parseRouteInput(input)` beside it that converts the same kinds of input into `{ host, port, scheme }`. `parseHostInput` accepts:

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

`parseRouteInput` SHALL apply the same rules and additionally return the scheme: `https` for an input that starts with `https://`, otherwise `http`. Its default port SHALL be 443 for `https` and 8000 (the dashboard's default port, `DEFAULT_DASHBOARD_PORT`) for `http`, whether the scheme was typed or implied. It SHALL reject any scheme other than `http` and `https`. `parseHostInput` SHALL keep its behaviour unchanged.

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

#### Scenario: Route input defaults per scheme
- **WHEN** `parseRouteInput("https://lab.example.org")` is called
- **THEN** it SHALL return `{ host: "lab.example.org", port: 443, scheme: "https" }`
- **AND** `parseRouteInput("office-mac.local")` SHALL return `{ host: "office-mac.local", port: 8000, scheme: "http" }`

#### Scenario: Route input keeps an explicit port and scheme
- **WHEN** `parseRouteInput("https://lab.example.org:8443")` or `parseRouteInput("http://192.168.16.202:9000")` is called
- **THEN** it SHALL return port 8443 with scheme `https`, or port 9000 with scheme `http`

#### Scenario: Route input rejects other schemes
- **WHEN** `parseRouteInput("ftp://host")` is called
- **THEN** it SHALL return `null`

### Requirement: Surface scan errors in the UI
The Servers section SHALL display the scan error message to the user when `POST /api/discover-servers` rejects (network error, server unreachable, etc.) instead of silently treating the failure as an empty result.

#### Scenario: Scan throws
- **WHEN** the user clicks "Scan network" and `discoverServers()` rejects with `Error("connection refused")`
- **THEN** the section SHALL render `Scan failed: connection refused` in a severity-error callout with a Retry action, beneath the scan button
- **AND** SHALL still mark the scan as completed so the empty-state diagnostic also appears

### Requirement: Operator accepts a move suggestion
The server SHALL expose an operator-only action that accepts an entry's move suggestion. Before writing, the server SHALL re-verify that the stored address of the entry's primary route still fails to prove the fingerprint and that the suggested address still proves it. On success it SHALL update the host and port of that primary route (and so the entry's `host` and `port`), preserving the entry's other routes, label, fingerprint and `addedAt`, and SHALL log the fingerprint with the old and new address. The Settings Servers section and the server selector SHALL offer this action on an entry that has a suggestion.

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

#### Scenario: Other routes survive an accepted move
- **GIVEN** an entry with a stored LAN route that no longer proves F and a proven tunnel route
- **WHEN** an operator accepts the suggestion for the LAN route
- **THEN** only the LAN route's host and port SHALL change and the tunnel route SHALL be kept

## REMOVED Requirements

### Requirement: Settings panel network discovery section
**Reason**: Network discovery is no longer a separate list; it is a source of the merged Servers section (see "Network discovery is a source of the Servers section" and "Settings panel known servers section").
**Migration**: The scan button, the diagnostic empty-state, the manual-add form, the already-added recognition and the request-landing action move into the Servers section unchanged in behaviour, except that the action formerly labelled "Connect" is labelled "Request access" and is chosen by the pair-action rule of the server-identity-routes capability.
