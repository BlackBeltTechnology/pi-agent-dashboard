## MODIFIED Requirements

### Requirement: Localhost and trusted host bypass
The auth module SHALL skip authentication entirely for requests originating from loopback addresses (`127.0.0.1`, `::1`, `::ffff:127.0.0.1`). Additionally, if `auth.bypassUrls` is configured, the auth module SHALL skip authentication for HTTP requests whose URL starts with any entry in that list. If `auth.bypassHosts` is configured **and the effective trust mode (`network.trustMode`, see the `trusted-networks` capability) is `"legacy"`**, the auth module SHALL skip authentication for requests originating from any matching IP (exact, wildcard, or CIDR); in `"pair"` mode a `bypassHosts` match SHALL NOT skip authentication. The loopback and `bypassUrls` rules apply before any cookie/session validation; the `bypassHosts` rule (legacy only) applies after a presented session cookie has been validated, so a valid session authenticates the request as such. These rules cover both HTTP requests and WebSocket upgrades.

When `requireLocalProof` is enabled, the genuinely-local (loopback, non-forwarded) condition in this requirement is narrowed by the "Opt-in local proof for loopback trust" requirement of `trust-and-credential-boundaries`; with it disabled (the default) this requirement is unchanged.

#### Scenario: Localhost HTTP request without cookie
- **WHEN** `requireLocalProof` is disabled and an HTTP request arrives from `127.0.0.1` with no auth cookie
- **THEN** the request SHALL proceed without authentication

#### Scenario: Localhost WebSocket upgrade without cookie
- **WHEN** `requireLocalProof` is disabled and a WebSocket upgrade request arrives from `::1` with no auth cookie
- **THEN** the upgrade SHALL proceed without authentication

#### Scenario: External HTTP request without cookie
- **WHEN** an HTTP request arrives from a non-loopback IP with no auth cookie and the URL does not match any `bypassUrls` entry
- **THEN** the server SHALL redirect to `/auth/login` (for HTML requests) or return 401 (for API/JSON requests)

#### Scenario: External WebSocket upgrade without cookie
- **WHEN** a WebSocket upgrade request arrives from a non-loopback IP with no valid auth cookie
- **THEN** the server SHALL reject the upgrade with HTTP 401

#### Scenario: External HTTP request matching bypassUrls
- **WHEN** an HTTP request arrives from a non-loopback IP with no auth cookie and the URL starts with an entry in `auth.bypassUrls`
- **THEN** the request SHALL proceed without authentication

#### Scenario: bypassHosts match in pair mode requires sign-in
- **WHEN** the effective trust mode is `"pair"`, `auth.bypassHosts` contains `"10.0.0.0/8"`, and an HTML request arrives from `10.0.0.5` with no auth cookie
- **THEN** the server SHALL redirect to `/auth/login`
