# mdns-discovery Specification

## Purpose

Lets dashboard servers and browsers find each other on a local network without hand-entered addresses. Covers server-side advertisement, client-side browsing including continuous background browsing, a preference for localhost when it is among the candidates, and a fallback to config-based probing when mDNS yields nothing.

## Requirements

### Requirement: Server mDNS advertisement
The dashboard server SHALL advertise itself via mDNS as `_pi-dashboard._tcp` on startup and unpublish on shutdown. The TXT record SHALL carry `{ version, pid, piPort, fp, name }`, where `version` is the dashboard server's own package version, `fp` is the server identity fingerprint (the same value the identity challenge proves), and `name` is the operator-configured dashboard name when set, otherwise the machine's hostname — for display only. The TXT record SHALL NOT carry any URL, tunnel address or other route of the server; the fingerprint is the only identity data. The `fp` key SHALL be present only when the server has an identity.

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

#### Scenario: Advertisement carries no routes
- **GIVEN** the server has an active tunnel and a public base URL
- **WHEN** a peer reads the TXT record
- **THEN** the keys SHALL be no others than `version`, `pid`, `piPort`, `name` and, when an identity exists, `fp`, and no value SHALL contain a tunnel or public URL

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

### Requirement: Localhost preference
When multiple servers are discovered, localhost servers SHALL be preferred over
remote servers. This preference SHALL apply both to initial selection and to any
later decision to re-target an established connection: a non-localhost candidate
SHALL NOT displace an established localhost connection.

#### Scenario: Both local and remote servers found
- **WHEN** `discoverDashboard()` finds both a localhost and a remote server
- **THEN** the localhost server SHALL be returned as the primary result
- **AND** remote servers SHALL be included as additional results

#### Scenario: Remote candidate does not displace an established localhost bridge
- **WHEN** the bridge is registered on a localhost endpoint and discovery reports a remote server
- **THEN** the bridge SHALL retain the localhost connection

#### Scenario: A `.local` hostname counts as remote
- **WHEN** a discovered candidate's host is an mDNS `*.local` name that does not resolve to a loopback address
- **THEN** it SHALL be treated as remote for the purposes of localhost preference

### Requirement: Fallback to config-based probe
When mDNS browse returns no results, the discovery module SHALL fall back to probing `localhost:<port>` from config and verifying via `GET /api/health`.

#### Scenario: mDNS blocked by firewall
- **WHEN** mDNS browse times out with no results
- **THEN** the module SHALL probe `localhost:<config.port>` and check `GET /api/health` for `{ ok: true }`

#### Scenario: Health check confirms dashboard
- **WHEN** the health probe returns `{ ok: true, pid: N }`
- **THEN** the fallback SHALL return the server as discovered with `source: "fallback"`

#### Scenario: Health check finds wrong service
- **WHEN** the port is open but `/api/health` does not return `{ ok: true }`
- **THEN** the fallback SHALL return no server found

#### Scenario: Port occupied by another service
- **WHEN** the configured port returns an HTTP response that is not the dashboard health format
- **THEN** the discovery SHALL report `portConflict: true` so the caller can show an appropriate error

### Requirement: Guarded migration away from an established bridge
The bridge SHALL NOT abandon a connection on which it has successfully registered
in favour of a discovered candidate unless that candidate has been verified
reachable. Verification SHALL be a `GET /api/health` returning `{ ok: true }` at
the candidate's advertised host and HTTP port, performed before the established
connection is dropped. A reachable health response alone SHALL NOT be sufficient
when the candidate must also prove its identity (see "Local-token holders require server counter-proof on every loopback dial").

#### Scenario: Unreachable candidate is rejected
- **WHEN** the bridge is registered on `ws://localhost:9999` and discovery reports a server at `home-imac-54922.local:9594` whose health check does not return `{ ok: true }`
- **THEN** the bridge SHALL keep its established connection
- **AND** it SHALL NOT re-target `ConnectionManager` at the candidate

#### Scenario: Reachable candidate is adopted
- **WHEN** the bridge is registered and a discovered candidate's health check returns `{ ok: true }`
- **AND** the candidate is preferred under the localhost-preference rule
- **AND** any identity proof required for that candidate has succeeded
- **THEN** the bridge MAY migrate to the candidate

#### Scenario: Healthy candidate without required proof is not adopted
- **WHEN** a discovered loopback candidate's health check returns `{ ok: true }` but it cannot return a valid counter-proof to a bridge holding the local token
- **THEN** the bridge SHALL keep its established connection
- **AND** the refusal SHALL be logged with cause `server_proof_missing` when no proof was returned, or `server_proof_invalid` when the proof had a bad MAC or timed out

#### Scenario: No health check, no migration
- **WHEN** a candidate is discovered but its health cannot be determined within the probe timeout
- **THEN** the established connection SHALL be retained

### Requirement: Migration is reversible
A migration that fails to establish SHALL NOT strand the bridge. After a bounded
number of failed connection attempts to a newly adopted endpoint, the bridge
SHALL return to the last endpoint on which it successfully registered.

#### Scenario: Failed migration falls back
- **WHEN** the bridge migrates to a candidate and the connection fails to open for the configured maximum attempts
- **THEN** the bridge SHALL re-target the last successfully registered endpoint
- **AND** it SHALL resume its normal reconnect behaviour against that endpoint

#### Scenario: Backoff does not grow without bound against a dead candidate
- **WHEN** connection attempts to a newly adopted endpoint fail repeatedly
- **THEN** the bridge SHALL NOT continue doubling its backoff against that endpoint indefinitely without attempting the previous endpoint

### Requirement: Bridge re-targeting is observable
Changing the endpoint of an established bridge SHALL be recorded with the
previous endpoint, the new endpoint, and the reason. The record SHALL reach the
dashboard server rather than depending on pi's stdout/stderr, which is discarded
unless `keeperLog.capturePiOutput` is enabled.

#### Scenario: Migration is logged server-side
- **WHEN** the bridge re-targets from one endpoint to another
- **THEN** a record naming both endpoints and the trigger SHALL be observable without enabling pi output capture

#### Scenario: Rejected migration is logged
- **WHEN** a discovered candidate is rejected by the reachability guard
- **THEN** the rejection SHALL be recorded with the candidate endpoint and the failure reason

### Requirement: Advertisement matches what the server serves
A dashboard server SHALL NOT advertise an address on which it does not accept
connections. A server bound only to loopback SHALL advertise a
loopback-resolvable address, or SHALL NOT advertise at all.

#### Scenario: Loopback-bound server does not advertise a LAN hostname
- **WHEN** a dashboard server listens only on `127.0.0.1`
- **THEN** it SHALL NOT publish an mDNS record whose host resolves to a non-loopback address

#### Scenario: Stale instance cannot poison discovery
- **WHEN** a dashboard instance is bound to loopback and another process is serving the machine's primary ports
- **THEN** bridges discovering the loopback-bound instance SHALL NOT be able to adopt an endpoint they cannot reach

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

### Requirement: Local-token holders require server counter-proof on every loopback dial

A bridge holding the local token SHALL require a valid server counter-proof on every loopback dial or retarget, `ws:` and `wss:` alike, regardless of `PI_DASHBOARD_REQUIRE_SERVER_PROOF`. Only `ws+unix:` is exempt (filesystem permissions). Without proof the bridge SHALL NOT register or send session data and SHALL log cause `server_proof_missing` or `server_proof_invalid`. Only `PI_DASHBOARD_ALLOW_UNPROVEN_LOCAL_SERVER=1` opts out, for servers predating counter-proof, and SHALL be logged.

#### Scenario: Rogue loopback listener is refused

- **GIVEN** a bridge holding the local token and a process on loopback that advertises `_pi-dashboard._tcp`, answers `/api/health`, but cannot return a valid counter-proof
- **WHEN** the bridge evaluates that advert
- **THEN** the bridge SHALL NOT register with it or send session data
- **AND** the refusal SHALL be logged with cause `server_proof_missing` (no proof returned) or `server_proof_invalid` (bad MAC or timeout)

#### Scenario: Configured endpoint is also proven

- **GIVEN** a bridge holding the local token whose configured endpoint is `localhost:8000`
- **AND** the process answering there returns no valid counter-proof
- **WHEN** the bridge connects
- **THEN** the bridge SHALL NOT register or send session data
- **AND** the refusal SHALL be logged with cause `server_proof_missing` (no proof returned) or `server_proof_invalid` (bad MAC or timeout)

#### Scenario: Genuine loopback server is adopted

- **GIVEN** a bridge holding the local token and a loopback server that returns a valid counter-proof
- **WHEN** the bridge evaluates the advert or connects to the configured endpoint
- **THEN** the bridge SHALL connect, with the proof requirement active even when `PI_DASHBOARD_REQUIRE_SERVER_PROOF` is unset or `0`

#### Scenario: Explicit opt-out for version skew

- **GIVEN** a bridge holding the local token, `PI_DASHBOARD_ALLOW_UNPROVEN_LOCAL_SERVER=1`, and a loopback server that predates counter-proof
- **WHEN** the bridge connects
- **THEN** the bridge SHALL connect without counter-proof
- **AND** SHALL log that proof is being skipped

#### Scenario: Other variables do not opt out

- **WHEN** `PI_DASHBOARD_REQUIRE_SERVER_PROOF` is `0` or unset and `PI_DASHBOARD_ALLOW_UNPROVEN_LOCAL_SERVER` is unset
- **THEN** counter-proof SHALL still be required for every loopback dial

#### Scenario: Unix socket dials are exempt

- **WHEN** a bridge holding the local token dials a `ws+unix:` endpoint
- **THEN** it SHALL NOT require counter-proof for that dial

#### Scenario: TLS loopback dial still requires counter-proof

- **GIVEN** a bridge holding the local token dialling a loopback `wss:` endpoint
- **WHEN** the server presents a valid TLS certificate but returns no valid counter-proof
- **THEN** the bridge SHALL NOT register or send session data
- **AND** the refusal SHALL be logged with cause `server_proof_missing` (no proof returned) or `server_proof_invalid` (bad MAC or timeout)

#### Scenario: Failure leaves the bridge searching

- **WHEN** proof verification fails for every candidate
- **THEN** the bridge SHALL remain disconnected (or on its established connection) and SHALL continue discovery

### Requirement: Device bearer never sent to an unpinned discovered host

A bridge SHALL NOT send a device bearer to a host that is not pinned. "Pinned" means `host:port` equality, after canonicalising both sides (lowercase, default port, no trailing dot, bracketed IPv6), with the configured endpoint or a server pin store entry's last endpoint; a lone stored pin SHALL NOT pin any other endpoint. A discovery-only host is unpinned, SHALL NOT receive the bearer, and the refusal SHALL be logged with cause `unpinned_discovered_host`.

#### Scenario: Unpinned discovered host never receives the device bearer

- **GIVEN** a bridge holding a device bearer and a discovered non-loopback host that is neither the configured endpoint host nor in the server pin store
- **WHEN** the bridge considers connecting to it
- **THEN** no request to that host SHALL carry the device bearer, including the connection ticket request
- **AND** the refusal SHALL be logged with cause `unpinned_discovered_host`

#### Scenario: Single stored pin is not a fallback

- **GIVEN** a server pin store holding exactly one entry whose last endpoint is `a.local:8000`
- **AND** a discovered host at `b.local:8000` or `a.local:9000`
- **WHEN** the bridge considers connecting to it
- **THEN** the host SHALL be treated as unpinned and SHALL NOT receive the device bearer

#### Scenario: Equivalent spellings of a pinned host are equal
- **GIVEN** a configured endpoint `Home.Local.:443` and a discovered host `home.local:443` (or `home.local` with the default port)
- **WHEN** the bridge considers connecting to it
- **THEN** the host SHALL be treated as pinned

#### Scenario: Configured or pin-store host receives the bearer

- **GIVEN** a bridge holding a device bearer and a `host:port` exactly equal to the configured endpoint or to a pin store entry's last endpoint
- **WHEN** the bridge connects to it
- **THEN** the bridge MAY send the device bearer
