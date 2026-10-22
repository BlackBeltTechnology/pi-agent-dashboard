## MODIFIED Requirements

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

## ADDED Requirements

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
