## MODIFIED Requirements

### Requirement: REST API to add a known server
The server SHALL expose `POST /api/known-servers` accepting `{ host, port, scheme?, label?, fingerprint? }` (`scheme` is `http` or `https`, default `http`) to add a server, or a route of an already known server, to the persisted list. The route SHALL require an operator credential as accepted by the server's existing operator guard (login session, local-proof cookie, local token, or a genuinely-local request); a caller admitted only by network trust or a paired-device credential SHALL be refused. Before writing, the server SHALL challenge the identity of the server at that route and SHALL pin only a proven fingerprint, attaching the route to the entry that holds it under the grouping rule of the server-identity-routes capability; `fingerprint` in the request is a hint and SHALL NOT be persisted unless proven. An add SHALL never clear or replace a fingerprint already pinned on an entry. When the proven fingerprint is this server's own, the add SHALL be refused with `self_address`, which takes precedence over every other post-challenge outcome. The operator guard SHALL still run first and contact nothing.

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
- **WHEN** an operator adds a route that is already stored on an entry pinned to fingerprint F and the challenge proves a different fingerprint G that is not this server's own
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

#### Scenario: Address that reaches this server itself is refused as self
- **WHEN** an operator adds `host:port` (new or pinned to F) and the challenge there proves this server's own fingerprint
- **THEN** the server SHALL respond `409` with error `self_address`, SHALL NOT pin, and the list SHALL be unchanged

#### Scenario: Non-operator add of a self address contacts nothing
- **WHEN** a caller without an operator credential adds an address that would reach this server itself
- **THEN** the add SHALL be refused by the operator guard and no identity challenge SHALL be sent


### Requirement: Unpinned reachable entry is backfilled
The server SHALL pin the fingerprint of a known entry that has none when the server at that entry's primary route proves an identity through the identity challenge, using the primary route's scheme. A fingerprint read from an mDNS advertisement alone SHALL NOT be persisted. Backfill SHALL NOT pin this server's own fingerprint.

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

#### Scenario: Unpinned entry that loops back is not pinned
- **WHEN** backfill challenges an unpinned entry and the challenge proves this server's own fingerprint
- **THEN** the entry SHALL remain without a fingerprint

### Requirement: Verified move suggestion for a renamed server
When a discovered peer advertises the fingerprint and port of a pinned known entry at a different host, and the entry's primary route no longer proves that fingerprint (challenged over the primary route's scheme) while the peer's address does, the server SHALL record a move suggestion for that entry and return it with the entry in the known-servers listing. The suggestion concerns the primary route only; the entry's other routes are neither challenged nor changed. The server SHALL NOT change the persisted entry on its own and SHALL NOT persist the suggestion. The server SHALL challenge a discovered address only when it is on a subnet of one of the server's own interfaces and is not a loopback, link-local, unspecified or multicast address. Recording and withdrawing a suggestion SHALL be logged. A suggestion SHALL be withdrawn when the primary route proves the fingerprint again, when the peer disappears, or when it has not been re-verified for 10 minutes. The server SHALL try the advert's eligible addresses in order (at most 4 challenges) until one proves the pinned fingerprint, and SHALL NOT record a suggestion for an address that proves this server's own fingerprint.

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

#### Scenario: Later address proves the pin after a self address
- **GIVEN** a discovered peer advertising pinned fingerprint F lists `192.168.64.1` first and `192.168.16.203` second, and the primary route no longer proves F
- **WHEN** `192.168.64.1` proves this server's own fingerprint and `192.168.16.203` proves F
- **THEN** a move suggestion to `192.168.16.203` SHALL be recorded

#### Scenario: Self address is not suggested as a move
- **WHEN** a discovered address advertising pinned fingerprint F proves this server's own fingerprint
- **THEN** no move suggestion SHALL be recorded
