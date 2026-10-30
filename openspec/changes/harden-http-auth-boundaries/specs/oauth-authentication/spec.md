## MODIFIED Requirements

### Requirement: Logout
The `POST /auth/logout` route SHALL revoke the presented `pi_dash_token` server-side (it SHALL stop verifying until its expiry), clear the cookie and redirect to `/auth/login`. With no usable token (absent, malformed, foreign-signed, expired or already revoked) it SHALL still clear the cookie and redirect, store nothing and write no audit line. If the revocation cannot be persisted, the token SHALL stay revoked in memory, the cookie SHALL be cleared and the response SHALL be 500 `revocation_not_persisted`.

#### Scenario: Logout clears session
- **WHEN** a POST request is made to `/auth/logout`
- **THEN** the server SHALL revoke that token, clear the `pi_dash_token` cookie and redirect to `/auth/login`


## ADDED Requirements

### Requirement: Session JWTs are rejected once revoked
A session JWT SHALL be rejected when its SHA-256 digest is in the server-side revocation store or its `iat` is not after the store's `notBefore`, on REST requests, `GET /auth/status` and WebSocket upgrades alike. Logout and revoke-all SHALL synchronously close the browser and terminal sockets that token admitted (directly or by a ticket minted from it) with the session-revoked code.

#### Scenario: Replay after logout is rejected
- **GIVEN** a valid session cookie that was then logged out
- **WHEN** the same token value is presented on a REST request
- **THEN** the server SHALL answer 401 (or redirect an HTML request to `/auth/login`), `GET /auth/status` SHALL report unauthenticated, and a WebSocket upgrade with it SHALL be refused

#### Scenario: Ticket minted from a revoked session is refused
- **GIVEN** a WebSocket ticket minted from a session that was then logged out
- **WHEN** the ticket is presented on an upgrade
- **THEN** the server SHALL respond `HTTP/1.1 401` and the ticket SHALL be consumed

#### Scenario: Other sessions are unaffected
- **WHEN** one session logs out
- **THEN** a different valid session of the same user SHALL remain valid

#### Scenario: Open socket closes after logout
- **GIVEN** a browser WebSocket admitted by a session cookie (or a ticket minted from it) that is then logged out
- **WHEN** the logout request completes
- **THEN** the socket SHALL already be closed with the session-revoked code, without waiting for a frame

#### Scenario: Logout leaves other sessions' sockets open
- **GIVEN** two sessions of the same user each holding a socket
- **WHEN** one logs out
- **THEN** only that session's sockets SHALL be closed

#### Scenario: Audit line carries no token
- **WHEN** a token is revoked
- **THEN** one audit line naming the reason SHALL be written and SHALL NOT contain the token or its digest

### Requirement: The session revocation store is durable and bounded
The store SHALL persist across restarts in a `0600` file under the dashboard state directory, keep an entry only until the token's own `exp`, and bound its size by setting `notBefore` to now rather than dropping a live entry. A store unreadable or schema-invalid at boot (a zero-byte file included) SHALL set `notBefore` to boot time, persist it and log one error; an absent file is empty. `notBefore` SHALL never decrease, and a failed write SHALL NOT drop an in-memory revocation.

#### Scenario: Revocation survives a restart
- **WHEN** the server restarts after a logout
- **THEN** the logged-out token SHALL still be rejected

#### Scenario: Entries expire with the token
- **WHEN** a revoked token's `exp` has passed
- **THEN** its entry SHALL be removed on the next write

#### Scenario: Overflow collapses to a revoke-all
- **WHEN** the live entry count would exceed the cap
- **THEN** `notBefore` SHALL be set to now and the list cleared, so no token that was revoked becomes valid

#### Scenario: Unreadable store fails closed
- **WHEN** the revocation file exists but cannot be read at boot
- **THEN** every token issued before boot SHALL be rejected, the new `notBefore` SHALL be persisted so the next boot does not repeat it, and one error SHALL be logged

#### Scenario: Invalid contents fail closed
- **WHEN** the file is zero bytes, `{}`, or has a non-numeric or negative `notBefore` or a non-array `revoked`
- **THEN** it SHALL be treated as unreadable: every token issued before boot SHALL be rejected

#### Scenario: notBefore never moves back
- **GIVEN** `notBefore` is T and the wall clock then steps back
- **WHEN** a revoke-all runs at T−30 s
- **THEN** `notBefore` SHALL stay T

#### Scenario: Boot-time persist failure keeps the in-memory cutoff
- **WHEN** an unreadable file cannot be rewritten at boot
- **THEN** the server SHALL start with `notBefore` at boot time in memory and log one error

#### Scenario: Absent store is empty
- **WHEN** the file does not exist at boot
- **THEN** no token SHALL be rejected on that account

### Requirement: An operator can revoke every session
`POST /api/auth/revoke-sessions` (tier `operate`) and `pi-dashboard revoke-sessions` SHALL set the store's `notBefore` to now, so every previously issued session JWT stops verifying, SHALL close open session-admitted browser and terminal sockets, and SHALL write an audit line. Device bearers, passkey credentials, the local token and `auth.secret` SHALL be untouched. The route SHALL NOT be exposed as an MCP tool.

#### Scenario: Operator revokes all sessions
- **WHEN** an operator calls the route
- **THEN** a session issued before the call SHALL be rejected and a session issued after SHALL verify

#### Scenario: Below-operate caller is refused
- **WHEN** a `control`-tier device or session calls the route
- **THEN** it SHALL be refused with 403 `insufficient_scope`

#### Scenario: Other credentials survive
- **WHEN** sessions are revoked
- **THEN** a paired-device bearer and the local token SHALL still authenticate

#### Scenario: CLI uses the local token
- **WHEN** `pi-dashboard revoke-sessions` runs on the host
- **THEN** it SHALL succeed through the local credential without a browser session, exit 0 and print the `notBefore` time and the number of sockets closed

#### Scenario: CLI failure exit codes
- **WHEN** the server is down, no local token exists, or the route answers an error
- **THEN** the CLI SHALL exit 1 with a message, and exit 2 on a usage error

#### Scenario: Persist failure or sweep failure keeps the revocation
- **WHEN** the store write or the socket sweep throws during revoke-all or logout
- **THEN** the revocation SHALL stay applied in memory, the write failure SHALL answer 500 `revocation_not_persisted`, a sweep failure SHALL answer 200, and the remaining sockets SHALL close on their next frame

### Requirement: Revocation also ends session-minted live-preview capabilities
A live-preview capability minted from a login session SHALL stop working once its session is revoked: by logout of that session, or by a revoke-all whose `notBefore` is not before the session's `iat`. Liveness SHALL be re-checked on every capability use.

#### Scenario: Revoke-all ends a preview minted from a session
- **GIVEN** a `/live/<id>/~c/<token>/` capability minted from a login session
- **WHEN** an operator revokes all sessions and the preview page requests its next asset
- **THEN** the request SHALL be refused

#### Scenario: Preview of an unrelated device survives
- **GIVEN** a capability minted from a paired-device credential
- **WHEN** sessions are revoked
- **THEN** that capability SHALL stay valid

### Requirement: Provider deletion requires the operate tier
`DELETE /api/config/auth/providers/:id` SHALL require tier `operate`, the tier of `PUT /api/config`, for REST and MCP callers alike (the chat gateway does not expose this verb).

#### Scenario: Control-tier device is refused
- **WHEN** a `control`-tier device calls the route
- **THEN** it SHALL receive 403 `insufficient_scope` and no provider SHALL be removed

#### Scenario: Control-tier login session is refused
- **WHEN** a `control`-tier login session calls the route with `?force=true`
- **THEN** it SHALL receive 403 and the last provider SHALL remain

#### Scenario: Operate caller is admitted
- **WHEN** an `operate`-tier device calls the route
- **THEN** the deletion semantics of "Provider deletion route" SHALL apply

#### Scenario: MCP tool tier follows
- **WHEN** an MCP client lists tools with a `control` token
- **THEN** `config_auth_providers_id` SHALL NOT be listed

## MODIFIED Requirements

### Requirement: Localhost and trusted host bypass
The auth module SHALL skip authentication for requests originating from loopback
addresses (`127.0.0.1`, `::1`, `::ffff:127.0.0.1`), subject to the local-proof
narrowing below.

- **`bypassUrls`.** If `auth.bypassUrls` is configured, the auth module SHALL
  skip authentication for HTTP requests whose URL starts with any entry in that
  list.
- **`bypassHosts`.** If `auth.bypassHosts` is configured **and the effective
  trust mode (`network.trustMode`, see the `trusted-networks` capability) is
  `"legacy"`**, the auth module SHALL skip authentication for requests
  originating from any matching IP (exact, wildcard, or CIDR). In `"pair"` mode
  a `bypassHosts` match SHALL NOT skip authentication.
- **Capability stamp and app mounts.** The auth module SHALL also skip
  authentication for an HTTP request carrying an accepted plugin capability stamp,
  and for a request under a registered plugin app mount (`/apps/<appId>/`); see
  `plugin-capability-routes`.
- **Ordering.** The loopback and `bypassUrls` rules apply before any
  cookie/session validation. The `bypassHosts` rule (legacy only) applies after
  a presented session cookie has been validated, so a valid session
  authenticates the request as such.

These rules cover both HTTP requests and WebSocket upgrades.

A `bypassHosts` skip only stops the sign-in demand; the network guard still decides. In upgrade-decided `legacy` mode (`network.trustModeOrigin` not `"operator"`) a credential-less `bypassHosts` match proceeds to observe-tier reads, the model proxy and a read-only socket only (see `trusted-networks`); every other request is refused with `network_not_allowed`.

The genuinely-local (loopback, non-forwarded) condition in this requirement is
narrowed by the "Opt-in local proof for loopback trust" requirement of
`trust-and-credential-boundaries`. That requirement is in effect by default
(`requireLocalProof` absent or `true`). Under it, a loopback request skips
authentication only for `observe`-tier `/api/*` routes unless it carries local
proof. Only with `requireLocalProof` explicitly `false` does the unnarrowed
loopback skip apply.

#### Scenario: Localhost HTTP request without cookie
- **WHEN** `requireLocalProof` is explicitly `false` and an HTTP request arrives from `127.0.0.1` with no auth cookie
- **THEN** the request SHALL proceed without authentication

#### Scenario: Localhost WebSocket upgrade without cookie
- **WHEN** `requireLocalProof` is explicitly `false` and a WebSocket upgrade request arrives from `::1` with no auth cookie
- **THEN** the upgrade SHALL proceed without authentication

#### Scenario: Localhost control request without proof under the default
- **WHEN** `requireLocalProof` is absent and a `control`/`operate` HTTP request or a `/ws` upgrade arrives from `127.0.0.1` with no auth cookie and no local proof
- **THEN** the auth module SHALL NOT skip authentication for it

#### Scenario: External HTTP request without cookie
- **WHEN** an HTTP request arrives from a non-loopback IP with no auth cookie, the URL does not match any `bypassUrls` entry or registered plugin app mount, and the request carries no accepted capability stamp
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

#### Scenario: Plugin app mount and capability request without cookie
- **WHEN** a non-loopback request with no auth cookie targets a registered `/apps/<appId>/` mount, or carries an accepted capability stamp
- **THEN** the request SHALL proceed without authentication

#### Scenario: bypassHosts match in upgrade-decided legacy mode stops at reads
- **WHEN** the effective trust mode is `"legacy"` with origin `"upgrade"`, `auth.bypassHosts` contains `"10.0.0.0/8"`, and a mutating request arrives from `10.0.0.5` with no auth cookie
- **THEN** the auth module SHALL NOT redirect to `/auth/login` and the network guard SHALL refuse it with 403 `network_not_allowed`
