# mdns-discovery Specification

## Purpose

Lets dashboard servers and browsers find each other on a local network without hand-entered addresses. Covers server-side advertisement, client-side browsing including continuous background browsing, a preference for localhost when it is among the candidates, and a fallback to config-based probing when mDNS yields nothing.
## Requirements
### Requirement: Server mDNS advertisement
The dashboard server SHALL advertise itself via mDNS as `_pi-dashboard._tcp` on startup and unpublish on shutdown.

#### Scenario: Server advertises on startup
- **WHEN** the dashboard server starts successfully
- **THEN** it SHALL publish a `_pi-dashboard._tcp` service with the HTTP port and TXT record containing `{ version, pid, piPort }`

#### Scenario: Server unpublishes on shutdown
- **WHEN** the dashboard server shuts down
- **THEN** it SHALL unpublish the mDNS service before closing

### Requirement: mDNS service browsing
A shared discovery module (`src/shared/mdns-discovery.ts`) SHALL browse for `_pi-dashboard._tcp` services and return discovered servers.

#### Scenario: Discover localhost server
- **WHEN** `discoverDashboard()` is called and a server is advertising on the local machine
- **THEN** it SHALL return the server with `host`, `port`, `piPort`, `version`, and `isLocal: true`

#### Scenario: Discover remote LAN server
- **WHEN** `discoverDashboard()` is called and a server is advertising on another LAN machine
- **THEN** it SHALL return the server with `isLocal: false` and the remote hostname

#### Scenario: No server found within timeout
- **WHEN** `discoverDashboard()` is called and no server is advertising
- **THEN** it SHALL return an empty result after the specified timeout (default 2 seconds)

### Requirement: Continuous background browsing
The discovery module SHALL support continuous browsing mode that emits events when servers appear or disappear.

#### Scenario: Server appears on network
- **WHEN** a new dashboard server starts advertising during continuous browsing
- **THEN** the module SHALL emit a `server-up` event with server details

#### Scenario: Server disappears from network
- **WHEN** an advertised server shuts down during continuous browsing
- **THEN** the module SHALL emit a `server-down` event with the server identifier

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
connection is dropped.

#### Scenario: Unreachable candidate is rejected
- **WHEN** the bridge is registered on `ws://localhost:9999` and discovery reports a server at `home-imac-54922.local:9594` whose health check does not return `{ ok: true }`
- **THEN** the bridge SHALL keep its established connection
- **AND** it SHALL NOT re-target `ConnectionManager` at the candidate

#### Scenario: Reachable candidate is adopted
- **WHEN** the bridge is registered and a discovered candidate's health check returns `{ ok: true }`
- **AND** the candidate is preferred under the localhost-preference rule
- **THEN** the bridge MAY migrate to the candidate

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

