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
