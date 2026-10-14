## MODIFIED Requirements

### Requirement: Guard jurisdiction and in-namespace public exceptions
The guard SHALL act only on requests within its jurisdiction namespaces (`/api/*`,
`/v1/*`, `/editor/*`, `/live/*`). Within `/api`, the guard SHALL allow these
in-namespace public exceptions without a pass condition: `GET /api/health`, the
`PUBLIC_PAIRING_PREFIXES` paths, and configured `auth.bypassUrls` prefixes. All
other in-jurisdiction requests SHALL require a pass condition (loopback /
genuine-local, trusted-network IP, or `isAuthenticated`).

Within `/api`, an enabled plugin public namespace (`/api/plugins/<id>/public/`, see `plugin-public-routes`) is an additional in-namespace public exception that requires no pass condition; a disabled namespace is answered `404` before the guard runs. The exception SHALL be evaluated on both the raw and the resolved target, like every other exception.

#### Scenario: health endpoint reachable unauthenticated
- **WHEN** an unauthenticated, untrusted request arrives at `GET /api/health`
- **THEN** the guard SHALL allow it

#### Scenario: pairing bootstrap reachable unauthenticated
- **WHEN** an unauthenticated request arrives at a `PUBLIC_PAIRING_PREFIXES` path (e.g. `/api/pair/redeem`)
- **THEN** the guard SHALL allow it

#### Scenario: query string does not defeat an exception
- **WHEN** an unauthenticated, untrusted request arrives at `GET /api/health?probe=1`
- **THEN** the guard SHALL allow it (matching is on the pathname, not the raw URL)

#### Scenario: near-miss path is not treated as an exception
- **WHEN** an unauthenticated, untrusted request arrives at `GET /api/healthz`
- **THEN** the guard SHALL deny it (exception matching is anchored, not a loose prefix)

#### Scenario: HEAD health check allowed
- **WHEN** an unauthenticated, untrusted `HEAD /api/health` request arrives
- **THEN** the guard SHALL allow it (the exception is not GET-only)

#### Scenario: unparseable URL fails closed
- **WHEN** a request arrives whose URL cannot be parsed into a pathname
- **THEN** the guard SHALL treat it as in-jurisdiction and deny it

#### Scenario: ws-ticket mint requires a pass condition
- **WHEN** an unauthenticated, untrusted request arrives at the `/api` ws-ticket mint endpoint
- **THEN** the guard SHALL deny it (the mint is not public)

#### Scenario: Enabled plugin public namespace reachable from any peer
- **WHEN** an unauthenticated request from an untrusted network arrives at an enabled `/api/plugins/web-chat/public/messages`
- **THEN** the guard SHALL allow it

#### Scenario: Other plugin routes stay guarded
- **WHEN** the same request targets `/api/plugins/web-chat/config`
- **THEN** the guard SHALL require a pass condition as before
