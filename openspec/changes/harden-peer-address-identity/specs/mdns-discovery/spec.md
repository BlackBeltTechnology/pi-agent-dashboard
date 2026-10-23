## MODIFIED Requirements

### Requirement: mDNS service browsing
A shared discovery module SHALL browse for `_pi-dashboard._tcp` services and return discovered servers. Each discovered server SHALL carry `host`, `port`, `piPort`, `version`, `isLocal`, `addresses`, and, when advertised, `fingerprint` and `name`. For a server on the local machine, `host` SHALL be an IP address literal of a local interface the server serves on, IPv4 preferred, so reaching it does not depend on mDNS name resolution. Every URL built from a discovered `host` SHALL bracket IPv6 literals. When the browsing process supplies its own dashboard fingerprint and an advert carries a different `fp`, that advert SHALL NOT be local, whatever addresses it shares with this machine; a matching `fp` alone SHALL NOT make an advert local.

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

#### Scenario: Remote server sharing a virtual-bridge address is not local
- **GIVEN** this machine's dashboard fingerprint is L and it has interface address `192.168.64.1`
- **WHEN** an advert with fingerprint F ≠ L lists addresses `192.168.64.1` and `192.168.16.203`
- **THEN** the discovered server SHALL have `isLocal: false`

### Requirement: Advertised addresses are limited to served interfaces
The server SHALL advertise only addresses it accepts connections on and that a peer can use without an interface zone. A server bound to one specific address SHALL advertise only that address. A server bound to a hostname SHALL advertise only the local interface addresses that hostname resolves to, and SHALL NOT advertise when it resolves to none. A server bound to all interfaces SHALL advertise its non-internal interface addresses except IPv6 link-local addresses and addresses of container or virtual bridge interfaces, including macOS virtual-machine bridges (`bridgeN`, `vmnet`, `vboxnet`). This exclusion is best-effort: consumers SHALL NOT rely on an advertised address being unique to the advertising machine. When the set of addresses it would advertise changes while running, the server SHALL re-advertise with the new set.

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

#### Scenario: macOS virtual-machine bridge is not advertised
- **GIVEN** the machine has interface `bridge102` with address `192.168.64.1`
- **WHEN** the server is bound to `0.0.0.0`
- **THEN** the advertised address records SHALL NOT contain `192.168.64.1`
