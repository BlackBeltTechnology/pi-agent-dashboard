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
When multiple servers are discovered, localhost servers SHALL be preferred over remote servers.

#### Scenario: Both local and remote servers found
- **WHEN** `discoverDashboard()` finds both a localhost and a remote server
- **THEN** the localhost server SHALL be returned as the primary result
- **AND** remote servers SHALL be included as additional results

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
