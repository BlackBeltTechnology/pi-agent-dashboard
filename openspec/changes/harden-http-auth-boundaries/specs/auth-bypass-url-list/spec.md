## MODIFIED Requirements

### Requirement: Configurable trusted hosts (auth bypass by source IP)
The dashboard SHALL support a `bypassHosts` field inside `auth` config containing an array of trusted source IPs or hostnames. **Only when the effective trust mode (`network.trustMode`, see the `trusted-networks` capability) is `"legacy"`**, requests originating from a matching IP SHALL skip OAuth authentication for both HTTP requests and WebSocket upgrades. In `"pair"` mode a matching IP SHALL NOT skip authentication; the entries define networks allowed to request pairing instead. The field SHALL be optional; when absent or empty, no additional hosts are bypassed.

**Cap narrowing.** A match skips OAuth authentication only; it is not authority. In upgrade-decided `legacy` mode (`network.trustModeOrigin` not `"operator"`, see `trusted-networks` "Network-only HTTP admissions are capped at observe in upgrade-decided legacy mode") the network guard then limits a credential-less match to observe-tier reads and the model proxy over HTTP, and to a read-only socket over WebSocket.

Supported formats:
- **Exact IP**: `"10.0.0.5"` — matches that specific IP
- **Wildcard**: `"10.0.0.*"` — matches any IP where `*` is replaced by digits
- **CIDR**: `"192.168.1.0/24"` — matches IPs within the CIDR range

#### Scenario: Request from exact trusted IP
- **WHEN** the effective trust mode is `"legacy"`, `auth.bypassHosts` contains `"10.0.0.5"` and a request arrives from `10.0.0.5`
- **THEN** the server SHALL process the request without requiring authentication

#### Scenario: Request from listed IP in pair mode
- **WHEN** the effective trust mode is `"pair"`, `auth.bypassHosts` contains `"10.0.0.5"` and a request arrives from `10.0.0.5` with no credential
- **THEN** the server SHALL enforce authentication as normal

#### Scenario: Request from untrusted IP
- **WHEN** `auth.bypassHosts` contains `"10.0.0.5"` and a request arrives from `10.0.0.6`
- **THEN** the server SHALL enforce authentication as normal

#### Scenario: Wildcard match
- **WHEN** the effective trust mode is `"legacy"`, `auth.bypassHosts` contains `"10.0.0.*"` and a request arrives from `10.0.0.99`
- **THEN** the server SHALL process the request without requiring authentication

#### Scenario: CIDR match
- **WHEN** the effective trust mode is `"legacy"`, `auth.bypassHosts` contains `"192.168.1.0/24"` and a request arrives from `192.168.1.50`
- **THEN** the server SHALL process the request without requiring authentication

#### Scenario: CIDR non-match
- **WHEN** `auth.bypassHosts` contains `"192.168.1.0/24"` and a request arrives from `192.168.2.50`
- **THEN** the server SHALL enforce authentication as normal

#### Scenario: WebSocket upgrade from trusted host
- **WHEN** the effective trust mode is `"legacy"`, `auth.bypassHosts` contains `"10.0.0.5"` and a WebSocket upgrade request arrives from `10.0.0.5` without an auth cookie
- **THEN** the upgrade SHALL proceed without authentication

#### Scenario: bypassHosts is empty
- **WHEN** `auth.bypassHosts` is `[]` or omitted from config
- **THEN** no additional hosts SHALL be bypassed (only localhost loopback applies)

#### Scenario: Match in upgrade-decided legacy reaches reads only
- **WHEN** the effective trust mode is `"legacy"` with origin `"upgrade"`, `auth.bypassHosts` contains `"10.0.0.5"`, and a credential-less request from `10.0.0.5` calls `POST /api/session/spawn`
- **THEN** OAuth SHALL NOT demand a sign-in, and the network guard SHALL refuse the request with 403 `network_not_allowed`
