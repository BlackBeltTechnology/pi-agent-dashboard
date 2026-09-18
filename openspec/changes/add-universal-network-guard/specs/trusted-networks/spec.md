## MODIFIED Requirements

### Requirement: Network guard threaded to all protected routes
The network guard SHALL be enforced as a single universal Fastify `onRequest`
hook whose jurisdiction is the sensitive HTTP namespaces (`/api/*`, `/v1/*`,
`/editor/*`, `/live/*`), installed once at startup and running regardless of
whether `config.authConfig` is present. Within jurisdiction the guard SHALL
deny-by-default: a request is allowed only if it satisfies a pass condition or an
in-namespace public exception. This replaces reliance on per-route
`preHandler: networkGuard` opt-in as the primary enforcement mechanism.
Route files SHALL continue to receive the guard via their `RouteDeps`
`networkGuard` field (created once from `resolvedTrustedNetworks` at startup);
that threading remains valid but is no longer the protection boundary.

Jurisdiction and in-namespace exception matching SHALL operate on the parsed
request **pathname** (query string and fragment stripped), with prefix matches
anchored on a trailing slash, so neither a query string (`/api/health?x=1`) nor a
near-miss prefix (`/apiv2`, `/api/healthz`) changes the decision.

The guard SHALL be registered as the **last** `onRequest` hook unconditionally —
after the host gate, CORS, the mutation-origin gate, CSP, `registerBearerAuth`,
`registerAuthPlugin` (when configured), the route-tier gate, and the model-proxy
auth gate (when configured) — so `request.isAuthenticated` reflects every auth
source when the guard evaluates. "Last" SHALL NOT be expressed relative to a
conditional hook.

The guard SHALL read the trusted-network set through the live thunk (the same
source `createNetworkGuard` uses), never a boot snapshot, so a CIDR added at
runtime admits without a restart.

A denial by the universal guard SHALL preserve the existing denial contract: the
`network_not_allowed` response body clients branch on, and the `blockEvents`
recording that feeds `GET /api/tunnel/block-events`. Core route registrations MAY retain their existing
`preHandler: networkGuard` as redundant defense-in-depth; these SHALL NOT be
required for a route to be protected.

#### Scenario: sensitive route protected by the universal hook alone
- **WHEN** the per-route `preHandler` is absent but the universal hook is installed, and a request to `POST /api/sessions/:id/prompt` arrives from an untrusted, unauthenticated IP
- **THEN** the request SHALL be denied by the universal hook (403)

#### Scenario: retained per-route guard is harmless
- **WHEN** a core route still declares `preHandler: networkGuard` and the universal hook is installed
- **THEN** the request SHALL be evaluated consistently (both agree) and SHALL NOT be double-rejected or error

#### Scenario: denial keeps the existing response contract
- **WHEN** the universal hook denies an in-jurisdiction request
- **THEN** the response body SHALL be the existing `network_not_allowed` shape
- **AND** the denial SHALL be recorded in the `blockEvents` buffer exposed by `GET /api/tunnel/block-events`

#### Scenario: runtime-added trusted CIDR admits without restart
- **WHEN** a CIDR is added to the trusted-network set while the server is running and a request arrives from that network
- **THEN** the guard SHALL allow it without a restart

#### Scenario: Session route uses network guard
- **WHEN** a request to `POST /api/sessions/:id/prompt` arrives from a trusted network IP
- **THEN** the route SHALL allow the request (guard passes)

#### Scenario: File route uses network guard
- **WHEN** a request to `GET /api/browse` arrives from an untrusted IP
- **THEN** the route SHALL return 403

## ADDED Requirements

### Requirement: Universal guard runs regardless of auth configuration
The universal `onRequest` guard SHALL enforce network policy on in-jurisdiction
routes even when auth is not configured. When `config.authConfig` is absent or its
provider registry is empty, `request.isAuthenticated` SHALL default to `false`
(decorated unconditionally) and the guard SHALL still deny non-loopback,
non-trusted, non-exception in-jurisdiction requests. Enforcement SHALL NOT depend
on the conditional OAuth `onRequest` hook being registered.

#### Scenario: plugin route denied over tunnel with auth off
- **WHEN** auth is not configured and a proxied/tunneled request (forwarding headers present, so not genuine-local) arrives at `POST /api/plugins/automation/create` from an untrusted IP
- **THEN** the guard SHALL deny the request with 403, write no automation file, and spawn no agent

#### Scenario: provider-auth route denied with auth off
- **WHEN** auth is not configured and an untrusted, unauthenticated request arrives at `PUT /api/provider-auth/api-key`
- **THEN** the guard SHALL deny the request with 403

#### Scenario: loopback allowed with auth off
- **WHEN** auth is not configured and a genuine-local loopback request arrives at a guarded route
- **THEN** the guard SHALL allow the request

### Requirement: Guard jurisdiction and in-namespace public exceptions
The guard SHALL act only on requests within its jurisdiction namespaces (`/api/*`,
`/v1/*`, `/editor/*`, `/live/*`). Within `/api`, the guard SHALL allow these
in-namespace public exceptions without a pass condition: `GET /api/health`, the
`PUBLIC_PAIRING_PREFIXES` paths, and configured `auth.bypassUrls` prefixes. All
other in-jurisdiction requests SHALL require a pass condition (loopback /
genuine-local, trusted-network IP, or `isAuthenticated`).

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

### Requirement: Non-API surfaces are not guarded
The guard SHALL NOT act on requests outside its jurisdiction namespaces, so the
app shell, static assets, `/manifest.json`, `/auth/*`, favicon, and PWA icons
remain reachable exactly as before this change. In particular the SPA index
(served at `/`) and SPA deep-link paths (served via `setNotFoundHandler`) SHALL
remain reachable unauthenticated.

#### Scenario: app shell loads with auth off over a tunnel
- **WHEN** auth is not configured and an unauthenticated tunnel request arrives at `GET /`
- **THEN** the SPA index SHALL be served (not denied)

#### Scenario: deep-link refresh loads
- **WHEN** an unauthenticated request arrives at a SPA deep-link path (e.g. `GET /settings`) served by the not-found fallback
- **THEN** the SPA index SHALL be served

#### Scenario: auth status probe reachable
- **WHEN** an unauthenticated client requests `GET /auth/status`
- **THEN** it SHALL be served (so the client can detect whether auth is enabled)

### Requirement: v1 model-proxy traffic authenticated via the proxy gate
The model-proxy auth gate SHALL set `request.isAuthenticated` to `true` upon
successful validation of a `pi-proxy-*` API key, so the universal guard admits
authenticated `/v1/*` traffic via the standard `isAuthenticated` pass condition.
There SHALL be no public allowlist entry for `/v1/*`; a `/v1/*` request without a
valid proxy key SHALL be rejected (by the proxy gate or the guard).

#### Scenario: valid proxy key passes
- **WHEN** a `/v1/messages` request presents a valid `pi-proxy-*` key
- **THEN** the proxy gate SHALL mark it authenticated and the guard SHALL allow it

#### Scenario: missing proxy key denied
- **WHEN** a `/v1/models` request arrives with no valid credential from an untrusted IP
- **THEN** the request SHALL be rejected (not silently allowed)

#### Scenario: proxy disabled leaves no v1 bypass
- **WHEN** the model proxy is disabled and an untrusted `/v1/*` request arrives
- **THEN** it SHALL NOT be admitted by any public `/v1` bypass

### Requirement: CORS preflight is not denied by the guard
The guard SHALL NOT break cross-origin preflight: `OPTIONS` preflight requests
SHALL continue to be answered by the CORS layer (registered before the guard) and
SHALL NOT be rejected with a network-policy 403.

#### Scenario: preflight to a guarded route succeeds
- **WHEN** a browser sends an `OPTIONS` preflight for `POST /api/sessions` from an allowed origin
- **THEN** the CORS layer SHALL answer it and the guard SHALL NOT deny it

### Requirement: No dangerous route outside the guarded namespaces
The codebase SHALL keep every dangerous (non-public, non-static, non-auth) HTTP
route under a guarded jurisdiction namespace (`/api`, `/v1`, `/editor`, `/live`)
or inside an **explicitly enumerated independently-authenticated namespace**,
verified by a test with plugin routes loaded, so a route added outside those
prefixes cannot silently bypass the guard.

The independently-authenticated set SHALL contain `/mcp` (which authenticates
in-handler via the paired-device token registry and deliberately does not trust
`request.isAuthenticated`). The static-allow set SHALL contain `/sw.js`. Adding a
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

### Requirement: Model-proxy second port stays loopback-bound or guarded
The optional model-proxy second-port Fastify instance SHALL bind to loopback
(`127.0.0.1`) only, and this SHALL be asserted by a test, so its `/v1/*` surface
(which runs only the proxy auth gate, not the universal guard) is never exposed
beyond loopback. If the second-port bind is ever made configurable beyond
loopback, the universal guard SHALL be installed on that instance too.

#### Scenario: second port binds loopback
- **WHEN** the model-proxy second port is enabled
- **THEN** it SHALL listen on `127.0.0.1` only, asserted by a test

#### Scenario: configurable bind requires the guard
- **WHEN** the second-port bind is changed to a non-loopback host
- **THEN** the universal guard SHALL be present on that instance (else the configuration SHALL be rejected)

### Requirement: Guard denials are logged
Each denial by the universal guard SHALL emit a structured log line including the
request path, source IP, and denial reason, so a probing LAN or tunnel client is
observable. The log line SHALL NOT include request bodies or secrets.

#### Scenario: denied request is logged
- **WHEN** the guard denies a request from `203.0.113.5` to `/api/sessions`
- **THEN** a log line SHALL record the path, source IP, and a reason
- **AND** it SHALL NOT contain the request body or any token
