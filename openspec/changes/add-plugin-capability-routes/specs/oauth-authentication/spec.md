## MODIFIED Requirements

### Requirement: Localhost and trusted host bypass
The auth module SHALL skip authentication entirely for requests originating from loopback addresses (`127.0.0.1`, `::1`, `::ffff:127.0.0.1`). Additionally, if `auth.bypassUrls` is configured, the auth module SHALL skip authentication for HTTP requests whose URL starts with any entry in that list. If `auth.bypassHosts` is configured, the auth module SHALL skip authentication for requests originating from any matching IP (exact, wildcard, or CIDR). The auth module SHALL also skip authentication for an HTTP request carrying an accepted plugin capability stamp, and for a request under a registered plugin app mount (`/apps/<appId>/`), see `plugin-capability-routes`. All bypass rules apply before any cookie/session validation, for both HTTP requests and WebSocket upgrades.

#### Scenario: Localhost HTTP request without cookie
- **WHEN** an HTTP request arrives from `127.0.0.1` with no auth cookie
- **THEN** the request SHALL proceed without authentication

#### Scenario: Localhost WebSocket upgrade without cookie
- **WHEN** a WebSocket upgrade request arrives from `::1` with no auth cookie
- **THEN** the upgrade SHALL proceed without authentication

#### Scenario: External HTTP request without cookie
- **WHEN** an HTTP request arrives from a non-loopback IP with no auth cookie, the URL does not match any `bypassUrls` entry or registered plugin app mount, and the request carries no accepted capability stamp
- **THEN** the server SHALL redirect to `/auth/login` (for HTML requests) or return 401 (for API/JSON requests)

#### Scenario: External WebSocket upgrade without cookie
- **WHEN** a WebSocket upgrade request arrives from a non-loopback IP with no valid auth cookie
- **THEN** the server SHALL reject the upgrade with HTTP 401

#### Scenario: External HTTP request matching bypassUrls
- **WHEN** an HTTP request arrives from a non-loopback IP with no auth cookie and the URL starts with an entry in `auth.bypassUrls`
- **THEN** the request SHALL proceed without authentication

#### Scenario: Plugin app mount and capability request without cookie
- **WHEN** a non-loopback request with no auth cookie targets a registered `/apps/<appId>/` mount, or carries an accepted capability stamp
- **THEN** the request SHALL proceed without authentication
