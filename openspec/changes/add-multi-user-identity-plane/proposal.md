## Why

The dashboard cannot safely serve multiple human principals today. HTTP authentication collapses callers into `request.isAuthenticated`; browser WebSockets may bootstrap global session/workspace/terminal state, accept mutating commands by caller-supplied ids, and broadcast plugin domain events globally. A principal-resolution hook alone would identify the caller but would not prevent cross-user reads or writes.

Topology B is the chosen architecture: a public browser client obtains a Keycloak access token with Authorization Code + PKCE, and the dashboard acts as the OAuth resource server. The dashboard must therefore validate the bearer before its existing cookie-auth hook rejects the request, carry the verified identity and token expiry through the WebSocket ticket, and enforce authorization at every host-owned HTTP and browser-WebSocket boundary.

This change supplies the complete host identity/enforcement plane on `develop`. The Keycloak resolver ships inside the dashboard but receives all realm/issuer/client details from settings. A separately developed product plugin attaches a host access policy for product-specific decisions; the dashboard never hardcodes InvoiceBot or any product role model.

## What Changes

### Authentication and principal resolution

- Add immutable `Principal { iss, sub, email? }`; exact `(iss, sub)` is the identity key and `email` is only a verified display label.
- Add `PrincipalResolution { principal, expiresAt }` so token lifetime can follow the identity onto a WebSocket.
- Add a bounded, DPoP-ready `AuthContext { method, url, authorization?, cookie?, dpop?, isAuthenticated, ip }`; resolvers never receive the raw request.
- Add one host resolver registry. The dispatch hook runs after the paired-device bearer hook but before the legacy cookie-auth hook can reject a request. A successful resolution sets `request.principal`, `request.principalExpiresAt`, and `request.isAuthenticated`; a resolver reject returns 401; `null` continues.
- Resolver registration requires an explicit host-owned capability grant (`identity.trustedResolverPlugins`); manifest priority controls ordering only and is never a trust boundary. Equal priority is deterministic by plugin id.
- Validate, copy, and freeze resolver output before exposing it. Empty or malformed `iss`, `sub`, or expiry is rejected.

### Bundled Keycloak resource-server resolver

- Ship a bundled dashboard resolver for JWT access tokens. It performs OIDC discovery, caches JWKS, verifies RS256 signature plus exact `iss`, required `aud`, optional required `azp`, `exp`, and DPoP proof when `cnf.jkt` is present.
- Seed every Keycloak value from dashboard/plugin settings via `getPluginConfig()`: issuer, audience, optional authorized party, optional JWKS URI, clock skew, network timeout, and explicit insecure-HTTP allowance for controlled Docker development. No realm, hostname, port, client id, audience, or key is hardcoded.
- Determine token ownership safely: opaque/device bearer or a JWT with another issuer returns `null`; a JWT claiming the configured issuer but failing validation returns reject.
- Topology-B multi-user mode conflicts with the existing `auth.providers.*` confidential login connectors. Configuration validation refuses that mixed mode rather than silently creating a cookie-auth bypass. Legacy mode remains unchanged.

### Explicit activation and default-inert rollout

- Add `identity.mode: legacy | multi-user`, default `legacy`.
- `legacy` preserves all existing HTTP, ticket, WebSocket bootstrap, command, and broadcast behavior.
- `multi-user` requires a configured Keycloak resolver and exactly one explicitly trusted host access-policy plugin before listen; invalid/incomplete configuration fails startup.
- In multi-user mode, principal-less human HTTP/WS access fails closed. Device/public pairing endpoints remain explicitly classified and continue their existing device flow.

### Full host authorization boundary

- Add one host access-policy contract `authorize({ principal, action, resource }) => Promise<boolean>`, registered only by an explicitly configured `identity.trustedPolicyPlugin`.
- Define stable host actions and resource descriptors for HTTP routes, WebSocket bootstrap frames, inbound WS commands, domain-event fan-out, and global/workspace/terminal operations. Unknown or unclassified protected routes/messages fail closed in multi-user mode.
- Require route metadata for host and plugin HTTP routes. Public/device routes are explicit; protected routes require a principal and a successful policy decision.
- Filter list/snapshot responses item-by-item. Do not merely authorize the container request and then return other users' resources.
- Bound policy calls by a configured timeout. Missing policy, throw, timeout, or malformed result denies access and logs a structured reason.

### Session ownership and browser WebSockets

- Persist `principalOwner?: { iss, sub }` in session metadata and expose it on session summaries. Compare it field-by-field with exact string equality.
- User-triggered `spawn_session` stamps `ws.principal` as owner. Trusted product-policy plugins may explicitly pass the current request principal through the trusted spawn API. Automation and legacy sessions remain ownerless.
- Enforce owner equality for every session read/write road: HTTP detail/transcript/mutation, WS bootstrap session snapshots, list/pagination, subscribe, replay/backfill, and inbound session commands.
- In multi-user mode browser upgrades require a single-use identity-bearing ticket. Cookie, local-token, trusted-network, or no-ticket browser upgrades do not bypass this requirement.
- Tickets bind principal plus `expiresAt`; sockets copy both and close at token expiry. Re-authentication occurs by obtaining a new token/ticket and reconnecting. Browser heartbeat only detects half-open transport; it does not claim to prove token validity.
- Filter OpenSpec/workspace/branch/terminal bootstrap and commands through the host access policy. Domain events use the same policy-driven targeted send; unconditional global product-event broadcast is forbidden in multi-user mode.

## Discipline Skills

Tasks in this change trigger these `eng-disciplines` skills:
- **security-hardening** — the whole change is auth/untrusted-input/session/token surface: JWT/JWKS/DPoP validation, the resolver trust grant, fail-closed authorization, and the WS bootstrap/command boundary.
- **observability-instrumentation** — new auth gate, policy decisions, and denials require structured audit events (§7.2) so a refusal is diagnosable.
- **performance-optimization** — the resolver runs on every request's hot path; JWKS caching/coalescing and bounded timeouts (§5.2, §4.4) sit on a latency budget.
- **doubt-driven-review** — applied during planning (two cycles) before this irreversible public-API/identity surface stands; re-apply before the migration cut-over to multi-user mode.

## Capabilities

### New Capabilities

- `principal-resolution`: trusted, ordered, bounded principal resolution integrated into the actual auth gate, with immutable validated results and expiry metadata.
- `keycloak-principal-resolver`: bundled, fully config-seeded Keycloak resource-server validation with discovery/JWKS caching and safe JWT/device/other-issuer disambiguation.
- `websocket-principal-binding`: mandatory identity-bearing browser tickets in multi-user mode, principal+expiry attachment, expiry closure, and transport heartbeat.
- `session-ownership-scoping`: persisted owner assignment and exact owner enforcement across all HTTP and WS session read/write roads.
- `host-access-policy`: explicit activation plus deny-by-default, plugin-supplied authorization for protected HTTP routes, WS bootstrap, inbound commands, global resources, and event fan-out.

### Modified Capabilities

<!-- Existing wire formats remain backward compatible in legacy mode. Multi-user mode adds authorization requirements rather than changing bridge-plane delivery classes or bridge ping/pong. -->

## Impact

- **Dashboard core:** auth-hook ordering; request decorators; plugin capability grants; route metadata/guards; startup readiness validation.
- **Bundled dashboard plugin/module:** Keycloak discovery, JWKS cache, JWT/DPoP validation, config schema.
- **Browser gateway:** ticket-only browser upgrades in multi-user mode; filtered bootstrap; authorized commands; session ownership; targeted event delivery; token-expiry timer; heartbeat.
- **Session persistence/shared protocol:** additive `principalOwner`; filtered snapshots and pagination.
- **Configuration:** additive `identity` settings; defaults to `legacy`. Multi-user mode rejects simultaneous legacy confidential login connectors.
- **Product plugins:** may register exactly one trusted access policy and use the trusted owned-spawn path. Product authorization data and decisions remain outside dashboard core.
- **Security:** no self-declared manifest field grants identity power. No human authority gates on `isAuthenticated` alone. Unknown surfaces and failures deny in multi-user mode.
- **Compatibility:** zero configuration preserves current behavior exactly. Enabling multi-user mode is an explicit cut-over; ownerless legacy/automation sessions are hidden from human principals until deliberately adopted or respawned.
