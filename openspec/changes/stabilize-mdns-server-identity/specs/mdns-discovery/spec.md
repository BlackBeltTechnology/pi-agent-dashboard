## MODIFIED Requirements

### Requirement: Server mDNS advertisement
The dashboard server SHALL advertise itself via mDNS as `_pi-dashboard._tcp` on startup and unpublish on shutdown. The TXT record SHALL carry `{ version, pid, piPort, fp, name }`, where `version` is the dashboard server's own package version, `fp` is the server identity fingerprint (the same value the identity challenge proves), and `name` is the operator-configured dashboard name when set, otherwise the machine's hostname — for display only.

#### Scenario: Server advertises on startup
- **WHEN** the dashboard server starts successfully
- **THEN** it SHALL publish a `_pi-dashboard._tcp` service with the HTTP port and TXT record containing `{ version, pid, piPort, fp, name }`

#### Scenario: Advertised version is the real version
- **WHEN** a peer reads the TXT record of a running server
- **THEN** `version` SHALL equal the `version` field of the dashboard server package that is running
- **AND** it SHALL NOT be the placeholder `0.0.0`

#### Scenario: Advertised fingerprint matches the identity challenge
- **WHEN** a peer reads `fp` from the TXT record and then challenges the server's identity
- **THEN** the fingerprint proven by the challenge SHALL equal the advertised `fp`

#### Scenario: Server unpublishes on shutdown
- **WHEN** the dashboard server shuts down
- **THEN** it SHALL unpublish the mDNS service before closing

### Requirement: mDNS service browsing
A shared discovery module SHALL browse for `_pi-dashboard._tcp` services and return discovered servers. Each discovered server SHALL carry `host`, `port`, `piPort`, `version`, `isLocal`, `addresses`, and, when advertised, `fingerprint` and `name`. For a server on the local machine, `host` SHALL be an IP address literal of a local interface the server serves on, IPv4 preferred, so reaching it does not depend on mDNS name resolution. Every URL built from a discovered `host` SHALL bracket IPv6 literals.

#### Scenario: Discover localhost server
- **WHEN** `discoverDashboard()` is called and a server is advertising on the local machine
- **THEN** it SHALL return the server with `host`, `port`, `piPort`, `version`, and `isLocal: true`
- **AND** `host` SHALL be an IPv4 address literal belonging to a local interface that the server serves on

#### Scenario: Local server with only IPv6 addresses
- **WHEN** a local server advertises no IPv4 address
- **THEN** the returned `host` SHALL be one of its IPv6 literals
- **AND** a health probe of that server SHALL use a bracketed URL and succeed

#### Scenario: Discover remote LAN server
- **WHEN** `discoverDashboard()` is called and a server is advertising on another LAN machine
- **THEN** it SHALL return the server with `isLocal: false` and the advertised hostname

#### Scenario: Identity fields are surfaced
- **WHEN** a discovered server's TXT record carries `fp` and `name`
- **THEN** the returned server SHALL carry `fingerprint` and `name` with those values

#### Scenario: Older server without identity fields
- **WHEN** a discovered server's TXT record carries no `fp`
- **THEN** the returned server SHALL omit `fingerprint` and SHALL otherwise be returned as before

#### Scenario: No server found within timeout
- **WHEN** `discoverDashboard()` is called and no server is advertising
- **THEN** it SHALL return an empty result after the specified timeout (default 2 seconds)

### Requirement: Continuous background browsing
The discovery module SHALL support continuous browsing mode that emits events when servers appear, change, or disappear. A peer SHALL be identified by its advertised service instance, and the identifier used when a peer disappears SHALL be the same one used when it appeared. A change to an advertised peer's host, port, addresses or TXT SHALL update the existing peer rather than create a new one. The module SHALL periodically re-browse so that address changes are picked up and a peer that stops answering without announcing its departure is removed.

#### Scenario: Server appears on network
- **WHEN** a new dashboard server starts advertising during continuous browsing
- **THEN** the module SHALL emit a `server-up` event with server details

#### Scenario: Server disappears from network
- **WHEN** an advertised server shuts down during continuous browsing
- **THEN** the module SHALL emit a `server-down` event with the server identifier
- **AND** the peer SHALL no longer be listed among known peers

#### Scenario: Peer with a non-DNS-safe host is removed on shutdown
- **WHEN** a peer whose advertised host is not a valid DNS name appeared and then stops advertising
- **THEN** the module SHALL remove that peer and emit `server-down` for it

#### Scenario: Renamed machine is one peer
- **WHEN** a machine running a server with fingerprint F on port P changes its OS hostname while advertising
- **THEN** the module SHALL track exactly one peer for that server, carrying its current address details

#### Scenario: Copy of this server's identity on another machine is listed
- **WHEN** another machine advertises this server's fingerprint and port
- **THEN** the server SHALL list it as a peer and SHALL NOT treat it as itself

#### Scenario: Two servers sharing an identity are two peers
- **WHEN** two servers with the same fingerprint advertise on different ports
- **THEN** the module SHALL track two peers, and one of them stopping SHALL NOT remove the other

#### Scenario: Updated advertisement refreshes the peer
- **WHEN** an advertised peer's address or TXT record changes without the service disappearing
- **THEN** the module SHALL update that peer's details within one refresh interval and emit an update event for it

#### Scenario: Silently vanished peer is removed
- **WHEN** a peer stops answering without sending a goodbye (crash, sleep, network loss)
- **THEN** the module SHALL remove it and emit `server-down` after it has been absent from three consecutive refreshes

## ADDED Requirements

### Requirement: Advertised hostname is owned by the dashboard
The server SHALL publish its service instance name, SRV target and address records under names derived from its identity and port, and SHALL NOT publish address records under the operating system's hostname. The derived hostname SHALL be a valid DNS label under `.local` and SHALL be stable across restarts and OS hostname changes for the same identity and port.

#### Scenario: Operating-system hostname is not contested
- **WHEN** the server advertises on a machine whose OS hostname is `H`
- **THEN** the server SHALL NOT answer mDNS address queries for `H` or `H.local`
- **AND** its SRV target SHALL NOT be `H` or `H.local`

#### Scenario: Names are stable across restarts and renames
- **WHEN** the server restarts with the same identity file and port, or the machine's OS hostname changes
- **THEN** the advertised instance name and hostname SHALL be identical to the previous run's

#### Scenario: Two servers on one machine do not collide
- **WHEN** two dashboard servers share one identity but listen on different ports on the same machine
- **THEN** their advertised instance names and hostnames SHALL differ

#### Scenario: Name conflict at startup is retried
- **WHEN** the server's instance name is reported in use when it starts advertising (for example while a previous process of the same server is still shutting down)
- **THEN** the server SHALL retry advertising a bounded number of times
- **AND** if the name is still in use it SHALL log a warning naming the instance and how to resolve a copied identity

#### Scenario: Hostname is a valid DNS label
- **WHEN** the advertised hostname is derived
- **THEN** its first label SHALL contain only lowercase letters, digits and hyphens, SHALL NOT start or end with a hyphen, and SHALL be at most 63 characters

### Requirement: Advertised addresses are limited to served interfaces
The server SHALL advertise only addresses it accepts connections on and that a peer can use without an interface zone. A server bound to one specific address SHALL advertise only that address. A server bound to a hostname SHALL advertise only the local interface addresses that hostname resolves to, and SHALL NOT advertise when it resolves to none. A server bound to all interfaces SHALL advertise its non-internal interface addresses except IPv6 link-local addresses and addresses of container or virtual bridge interfaces. When the set of addresses it would advertise changes while running, the server SHALL re-advertise with the new set.

#### Scenario: Specific bind advertises only that address
- **WHEN** the server is bound to `192.168.16.31`
- **THEN** the advertised address records SHALL contain `192.168.16.31` and no other address

#### Scenario: Hostname bind advertises its local addresses
- **WHEN** the server is bound to a hostname resolving to a local interface address A and a non-local address B
- **THEN** the advertised address records SHALL contain A and SHALL NOT contain B

#### Scenario: All-interfaces bind advertises interface addresses
- **WHEN** the server is bound to `0.0.0.0` or `::`
- **THEN** the advertised address records SHALL contain the machine's non-internal interface addresses
- **AND** SHALL NOT contain any IPv6 link-local (`fe80::/10`) address
- **AND** SHALL NOT contain the address of a container bridge interface such as `docker0`

#### Scenario: Address change is re-advertised
- **WHEN** the machine's LAN address changes while the server runs
- **THEN** the server SHALL advertise the new address and stop advertising the old one within one refresh interval

#### Scenario: Teardown withdraws the advertised records
- **WHEN** the server shuts down
- **THEN** the goodbye it sends SHALL cover the same records it advertised, under the dashboard-owned names
