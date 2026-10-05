## MODIFIED Requirements

### Requirement: Guard jurisdiction and in-namespace public exceptions
The guard SHALL act only on requests within its jurisdiction namespaces (`/api/*`,
`/v1/*`, `/editor/*`, `/live/*`). Within `/api`, the guard SHALL allow these
in-namespace public exceptions without a pass condition: `GET /api/health`, the
`PUBLIC_PAIRING_PREFIXES` paths, configured `auth.bypassUrls` prefixes, and a request
the capability hook stamped as accepted (a GET or HEAD under a plugin capability
prefix whose verifier accepted it; see `plugin-capability-routes`). All other in-jurisdiction requests SHALL require a
pass condition (loopback / genuine-local, trusted-network IP, or
`isAuthenticated`).

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

#### Scenario: capability prefix admits only a verified GET
- **WHEN** an unauthenticated, untrusted request arrives at a registered plugin capability prefix
- **THEN** the guard SHALL allow it only if the capability hook stamped it as accepted, and SHALL deny it otherwise

### Requirement: Network guard factory
The `localhost-guard` module SHALL export a `createNetworkGuard(trustedNetworks: string[] | (() => string[]))` function that returns a Fastify preHandler. The returned handler SHALL allow requests that satisfy any of: (a) genuinely local — loopback peer (`127.0.0.1`, `::1`, `::ffff:127.0.0.1`) **and** no proxy-forwarding header, (b) a valid local-IPC token, (c) `isTrustedSource(ip, headers, trustedNetworks)` is `true`, (d) `request.isAuthenticated` is `true` (set by the auth `onRequest` hook), or (e) the request carries an accepted plugin capability stamp (see `plugin-capability-routes`).

All other requests SHALL receive a **403 with a self-describing JSON body** of the shape `{ success: false, error: "network_not_allowed", reason: string, hint: string }`:
- `error` SHALL be the machine-readable literal `"network_not_allowed"` (replacing the prior human string `"Access denied"`), so clients can branch on policy-denial vs transport failure.
- `reason` SHALL describe the cause (e.g. `"source IP not loopback, not in trustedNetworks, and request not authenticated"`).
- `hint` SHALL describe the remedy (e.g. `"Add this network to trustedNetworks (Settings → Servers) or sign in."`).

The existing `localhostGuard` export SHALL be preserved for backward compatibility.

#### Scenario: Loopback IP allowed
- **WHEN** a request arrives from `127.0.0.1` with no proxy-forwarding header
- **THEN** the guard SHALL allow the request regardless of trustedNetworks or authentication

#### Scenario: Relayed loopback not allowed by loopback alone
- **WHEN** a request arrives from `127.0.0.1` carrying `X-Forwarded-For`, is not authenticated, and carries no local-IPC token
- **THEN** the guard SHALL return 403 `network_not_allowed` even if `trustedNetworks` contains a loopback entry

#### Scenario: Denied request body is self-describing
- **WHEN** `trustedNetworks` is empty, `request.isAuthenticated` is `false`, and a request arrives from `192.168.1.5`
- **THEN** the guard SHALL return 403
- **AND** the response body SHALL be `{ success: false, error: "network_not_allowed", reason, hint }` where `error` is exactly `"network_not_allowed"`
- **AND** `hint` SHALL name the remedy (add to `trustedNetworks` or authenticate)

#### Scenario: Authenticated request allowed
- **WHEN** `request.isAuthenticated` is `true`
- **THEN** the guard SHALL allow the request and SHALL NOT emit the `network_not_allowed` body

#### Scenario: Capability-stamped request allowed
- **WHEN** an unauthenticated remote request carries an accepted capability stamp
- **THEN** the guard SHALL allow it, so a plugin route attaching `ctx.networkGuard` agrees with the universal hook

### Requirement: No dangerous route outside the guarded namespaces
The codebase SHALL keep every dangerous (non-public, non-static, non-auth) HTTP
route under a guarded jurisdiction namespace (`/api`, `/v1`, `/editor`, `/live`)
or inside an **explicitly enumerated independently-authenticated namespace**,
verified by a test with plugin routes loaded, so a route added outside those
prefixes cannot silently bypass the guard.

The independently-authenticated set SHALL contain `/mcp` (which authenticates
in-handler via the paired-device token registry and deliberately does not trust
`request.isAuthenticated`). The static-allow set SHALL contain `/sw.js` and the `/apps/<appId>/` mounts made through `serveApp` (static, extension-allowlisted, no data). Adding a
namespace to either set SHALL be an explicit code change, not an implicit
fall-through. No client-side SPA route SHALL live under a guarded namespace,
since an unmatched in-jurisdiction path is denied rather than falling through to
the SPA handler.

#### Scenario: namespace-coverage test
- **WHEN** the route table is enumerated in a test with plugin routes registered
- **THEN** every non-static, non-`/auth`, non-public route SHALL resolve under a guarded namespace or an enumerated independently-authenticated namespace, else the test SHALL fail

#### Scenario: /mcp is enumerated, not ignored
- **WHEN** the coverage test encounters a `/mcp*` route
- **THEN** it SHALL pass only via the explicit independently-authenticated entry
- **AND** a test SHALL assert every `/mcp*` route (including the bare `/mcp`) requires the plugin's own device-token auth

#### Scenario: no SPA route under a guarded namespace
- **WHEN** the client route table is enumerated
- **THEN** no client-side route SHALL start with `/api/`, `/v1/`, `/editor/`, or `/live/`

#### Scenario: /apps mounts are enumerated, not ignored
- **WHEN** the coverage test encounters a `/apps/*` route
- **THEN** it SHALL pass only if the route was mounted through `serveApp`
