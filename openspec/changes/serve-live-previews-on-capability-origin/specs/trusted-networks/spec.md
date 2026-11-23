## MODIFIED Requirements

### Requirement: Network guard threaded to all protected routes
The network guard SHALL be enforced as a single universal Fastify `onRequest`
hook whose jurisdiction is the sensitive HTTP namespaces (`/api/*`, `/v1/*`,
`/editor/*`, `/live/*`, `/preview/*`), installed once at startup and running regardless of
whether `config.authConfig` is present. Within jurisdiction the guard SHALL
deny-by-default: a request is allowed only if it satisfies a pass condition or an
in-namespace public exception. This replaces reliance on per-route
`preHandler: networkGuard` opt-in as the primary enforcement mechanism.
Route files SHALL continue to receive the guard via their `RouteDeps`
`networkGuard` field (created once at startup over the live admission-list thunk);
that threading remains valid but is no longer the protection boundary.

No route SHALL be reachable through the sensitive namespaces without the network guard because it was registered late (for example by a plugin hot-load). Registering a route after the server has started SHALL fail, and the route SHALL NOT be served; that refusal is the enforcement. The server SHALL NOT work around it by serving sensitive-namespace routes from a second server instance or other after-start mechanism without the guard installed, and a regression test SHALL fail if post-start route registration stops being refused. A failed post-start registration SHALL be logged and the registering plugin marked failed; the server SHALL keep running. Any future facility that adds routes after start SHALL install the network guard on them.

Jurisdiction and in-namespace exception matching SHALL operate on the parsed
request **pathname** (query string and fragment stripped), with prefix matches
anchored on a trailing slash, so neither a query string (`/api/health?x=1`) nor a
near-miss prefix (`/apiv2`, `/api/healthz`) changes the decision.

The guard SHALL be registered as the **last** `onRequest` hook unconditionally —
after the host gate, CORS, the mutation-origin gate, CSP, `registerBearerAuth`,
`registerAuthPlugin` (when configured), the live-preview capability hook, the route-tier gate, and the model-proxy
auth gate (when configured) — so `request.isAuthenticated` reflects every auth
source when the guard evaluates. "Last" SHALL NOT be expressed relative to a
conditional hook.

The guard SHALL read the admission list (the trusted-network set in `"legacy"`
mode, empty in `"pair"` mode) through the live thunk, never a boot snapshot, so a
CIDR added at runtime in `"legacy"` mode admits without a restart and a switch to
`"pair"` mode stops admitting without a restart.

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
- **WHEN** the effective trust mode is `"legacy"`, a CIDR is added to the trusted-network set while the server is running, and a request arrives from that network
- **THEN** the guard SHALL allow it without a restart

#### Scenario: Session route uses network guard
- **WHEN** the effective trust mode is `"legacy"` and a request to `POST /api/sessions/:id/prompt` arrives from a trusted network IP
- **THEN** the route SHALL allow the request (guard passes)

#### Scenario: Session route denies a listed peer in pair mode
- **WHEN** the effective trust mode is `"pair"` and an unauthenticated request to `POST /api/sessions/:id/prompt` arrives from a listed network IP
- **THEN** the route SHALL return 403

#### Scenario: File route uses network guard
- **WHEN** a request to `GET /api/browse` arrives from an untrusted IP
- **THEN** the route SHALL return 403

#### Scenario: Late-registered route is not left unguarded
- **WHEN** code attempts to register a route under a sensitive namespace after the server has started
- **THEN** the registration SHALL fail and the route SHALL NOT be served
- **AND** where a future mechanism permits post-start routes, a request to such a route from an untrusted, unauthenticated IP SHALL be denied by the network guard

#### Scenario: Failed post-start registration does not stop the server
- **WHEN** a plugin's route registration fails after the server has started
- **THEN** the failure SHALL be logged and the plugin marked failed
- **AND** the server SHALL keep serving all other routes

#### Scenario: Tier-5 preview namespace is in jurisdiction
- **WHEN** an unauthenticated request from an untrusted IP arrives at `/preview/<pid>/x` with no live `<pid>`
- **THEN** it SHALL NOT be served or forwarded upstream (guard denial, or the capability 404 of `live-server-preview`)
- **AND** a request carrying a live `<pid>` is authenticated by the live-preview capability hook and passes the guard

### Requirement: Guard jurisdiction and in-namespace public exceptions
The guard SHALL act only on requests within its jurisdiction namespaces (`/api/*`,
`/v1/*`, `/editor/*`, `/live/*`, `/preview/*`). Within `/api`, the guard SHALL allow these
in-namespace public exceptions without a pass condition: `GET /api/health`, the
`PUBLIC_PAIRING_PREFIXES` paths, and configured `auth.bypassUrls` prefixes. All
other in-jurisdiction requests SHALL require a pass condition (loopback /
genuine-local, local-IPC token, `isAuthenticated`, or — in `"legacy"` trust mode
only — a trusted-network IP).

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

#### Scenario: preview namespace has no public exception
- **WHEN** an unauthenticated, untrusted request arrives at `/preview/x/` with no live capability
- **THEN** the guard SHALL NOT allow it as a public exception

### Requirement: No dangerous route outside the guarded namespaces
The codebase SHALL keep every dangerous (non-public, non-static, non-auth) HTTP
route under a guarded jurisdiction namespace (`/api`, `/v1`, `/editor`, `/live`, `/preview`)
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
- **THEN** no client-side route SHALL start with `/api/`, `/v1/`, `/editor/`, `/live/`, or `/preview/`
