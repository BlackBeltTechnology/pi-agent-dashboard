## MODIFIED Requirements

### Requirement: WebSocket upgrade auth check
The server's `upgrade` handler SHALL validate authentication for non-localhost WebSocket upgrade requests when auth is enabled. The check SHALL parse the `cookie` header from the upgrade request and validate the JWT. Independently of auth configuration, the handler SHALL first apply the cross-site Origin gate (see `cross-site-request-gate`): an upgrade carrying an untrusted `Origin` header is rejected with HTTP 403 even when the peer is localhost.

#### Scenario: External WebSocket upgrade with valid cookie
- **WHEN** a non-localhost WebSocket upgrade request includes a valid `pi_dash_token` cookie
- **THEN** the upgrade SHALL proceed normally

#### Scenario: External WebSocket upgrade without valid cookie
- **WHEN** a non-localhost WebSocket upgrade request has no valid `pi_dash_token` cookie and auth is enabled
- **THEN** the server SHALL destroy the socket with HTTP 401

#### Scenario: Localhost WebSocket upgrade — no check
- **WHEN** a localhost WebSocket upgrade request arrives with no `Origin` header or with a trusted `Origin` (regardless of auth config)
- **THEN** the upgrade SHALL proceed without cookie validation

#### Scenario: Localhost WebSocket upgrade with untrusted Origin is rejected
- **WHEN** a localhost WebSocket upgrade request arrives with an `Origin` header the dashboard does not trust (regardless of auth config)
- **THEN** the server SHALL destroy the socket with HTTP 403 before any cookie, ticket, or local-token check
