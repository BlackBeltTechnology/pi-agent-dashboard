## MODIFIED Requirements

### Requirement: REST API to add a known server
The server SHALL expose `POST /api/known-servers` accepting `{ host, port, label?, fingerprint? }` to add a server to the persisted list. The route SHALL require an operator credential as accepted by the server's existing operator guard (login session, local-proof cookie, local token, or a genuinely-local request); a caller admitted only by network trust or a paired-device credential SHALL be refused. Before writing, the server SHALL challenge the identity of the server at `host:port` and SHALL pin only a proven fingerprint; `fingerprint` in the request is a hint and SHALL NOT be persisted unless proven. An add SHALL never clear or replace a fingerprint already pinned on an entry. When the proven fingerprint is this server's own, the add SHALL be refused with `self_address`, which takes precedence over every other post-challenge outcome. The operator guard SHALL still run first and contact nothing.

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
- **WHEN** an operator adds `host:port` whose existing entry is pinned to fingerprint F and the challenge proves a different fingerprint G that is not this server's own
- **THEN** the server SHALL respond `409` with error `identity_changed` naming the expected and proven fingerprints
- **AND** SHALL NOT modify the entry

#### Scenario: Non-operator add refused
- **WHEN** a caller admitted only by network trust or a paired-device credential calls `POST /api/known-servers`
- **THEN** the server SHALL refuse the request, SHALL NOT contact the target, and SHALL NOT modify `knownServers`

#### Scenario: Address that reaches this server itself is refused as self
- **WHEN** an operator adds `host:port` (new or pinned to F) and the challenge there proves this server's own fingerprint
- **THEN** the server SHALL respond `409` with error `self_address`, SHALL NOT pin, and the list SHALL be unchanged

#### Scenario: Non-operator add of a self address contacts nothing
- **WHEN** a caller without an operator credential adds an address that would reach this server itself
- **THEN** the add SHALL be refused by the operator guard and no identity challenge SHALL be sent

### Requirement: Unpinned reachable entry is backfilled
The server SHALL pin the fingerprint of a known entry that has none when the server at that entry's stored address proves an identity through the identity challenge. A fingerprint read from an mDNS advertisement alone SHALL NOT be persisted. Backfill SHALL NOT pin this server's own fingerprint.

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

#### Scenario: Unpinned entry that loops back is not pinned
- **WHEN** backfill challenges an unpinned entry and the challenge proves this server's own fingerprint
- **THEN** the entry SHALL remain without a fingerprint

### Requirement: Verified move suggestion for a renamed server
When a discovered peer advertises the fingerprint and port of a pinned known entry at a different host, and the entry's stored address no longer proves that fingerprint while the peer's address does, the server SHALL record a move suggestion for that entry and return it with the entry in the known-servers listing. The server SHALL NOT change the persisted entry on its own and SHALL NOT persist the suggestion. The server SHALL challenge a discovered address only when it is on a subnet of one of the server's own interfaces and is not a loopback, link-local, unspecified or multicast address. Recording and withdrawing a suggestion SHALL be logged. A suggestion SHALL be withdrawn when the stored address proves the fingerprint again, when the peer disappears, or when it has not been re-verified for 10 minutes. The server SHALL try the advert's eligible addresses in order (at most 4 challenges) until one proves the pinned fingerprint, and SHALL NOT record a suggestion for an address that proves this server's own fingerprint.

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

#### Scenario: Later address proves the pin after a self address
- **GIVEN** a discovered peer advertising pinned fingerprint F lists `192.168.64.1` first and `192.168.16.203` second, and the stored address no longer proves F
- **WHEN** `192.168.64.1` proves this server's own fingerprint and `192.168.16.203` proves F
- **THEN** a move suggestion to `192.168.16.203` SHALL be recorded

#### Scenario: Self address is not suggested as a move
- **WHEN** a discovered address advertising pinned fingerprint F proves this server's own fingerprint
- **THEN** no move suggestion SHALL be recorded
