## Context

See `proposal.md - Why`. The plane spans two request lifecycles with different shapes:

- **HTTP** is short-lived and re-authenticated every call; carrying identity here is per-request state. Current-state facts (`packages/server/src/server.ts`): the auth chain adds root-level `onRequest` hooks in registration order and settles `request.isAuthenticated` (decorated at 1397, set by `registerBearerAuth` at 1401 and `registerAuthPlugin` at 1403); plugins load at ~2200 (`loadServerEntries`) strictly before `fastify.listen()` at 2804; registry-style plugin hooks (`onSessionResolved`/`onEvent`) push into a Set and return an unsubscribe fn (~2258-2266); `spawnSession` already implements the `priority <= 100` trust gate (~2280).
- **WebSocket** is long-lived and authenticated once at upgrade. Current-state facts: ws-ticket mint at ~1785 records scope + optional `deviceId`, never a user; upgrade validate at ~2643; `browser-gateway.ts` holds `subscriptions: Map<WebSocket, Set<string>>` and a global `broadcast()` that iterates every socket; the browser plane has no heartbeat (the existing `ws-ping-pong` spec is bridge-plane and triggers bridge reconnect).

## Goals / Non-Goals

**Goals:**
- One identity, carried onto both planes: `request.principal` (HTTP) and `ws.principal` (WS), from a single resolution.
- Multi-user correctness: a socket streams only what its principal owns/may see; domain events stop reaching non-owners.
- Default-inert HTTP seam (upstreamable), fail-closed everywhere a principal is absent.

**Non-Goals:**
- The InvoiceBot `canSee` implementation and product authorization — downstream. (The default Keycloak resolver IS in scope here, config-seeded.)
- The product meaning of "owner" and how ownership is assigned to a session at spawn (this change only records/reads an owner; stamping product identity is downstream).

## Decisions

### D1 — Registry model for principal resolution (forced by pure priority)
Core registers one `onRequest` hook after the auth chain (~1404). Plugins call `ctx.registerPrincipalResolver(resolve, priority)` during load; the hook sorts `(priority asc, registrationIndex asc)` and returns the first non-null principal. Per-plugin `onRequest` hooks are rejected: Fastify runs hooks in registration (load) order, which cannot honor a priority number, and an encapsulated plugin hook would not cover core routes. Mirrors `onSessionResolved`.

### D2 — First-match, stable tie-break, silent winner
First non-null wins; equal priorities fall back to registration order with a warning log (not a boot or request failure). Reuses the priority number rather than an `overrides` field or last-registered-wins.

### D3 — Trust gate reuses `priority <= 100`
Both `registerPrincipalResolver` and the `canSee` predicate registration are gated at `priority <= 100`; untrusted plugins get no-op registrars. A plugin that decides *who you are* or *who may see what* must be at least as trusted as the spawn gate. Auth/authorization plugins render no UI slot, so the render-order hazard behind non-priority provider-credential gating does not apply.

### D4 — Async resolver, bounded, three-valued, fail-closed
`resolve(ctx) => Promise<Principal | ResolverReject | null>`. `null` = "not my credential, continue"; `Principal` = claim; `ResolverReject` = "mine and invalid" — the walk stops fail-closed and the request MAY be answered 401 rather than falling through to a lower-priority resolver. A throw/reject/timeout is caught and treated as `null`, logged, never a 500. The three-valued result mirrors Spring `ProviderManager` (return-null vs throw `AuthenticationException`); collapsing invalid-token into a silent `null` would lose the ability to return a hard 401 on a bad JWT. Async lets a resolver cache JWKS lazily; caching is the resolver's responsibility since the hook is hot-path.

### D5 — Curated `AuthContext`, DPoP-ready, not the raw request
Resolvers receive `{ method, url, authorization?, cookie?, dpop?, isAuthenticated, ip }` — a bounded allowlist, never the raw request. This is the "credential seed" handed core→plugin; the principal flows plugin→core, and neither side names the other, which is what makes the resolver swappable across IdPs. `method`+`url`+`dpop` are included up front because Topology B's defining risk is browser-held tokens stolen via XSS, and the standard mitigation is sender-constrained tokens (DPoP, RFC 9449), whose proof validation needs the HTTP method, URL, and `DPoP` header. Shipping them now avoids a schema break if DPoP is adopted; non-DPoP resolvers ignore them.

### D9 — Keycloak resolver is config-seeded; conflicts with the legacy login connector are resolved by role separation
The default Keycloak resolver reads every IdP value from plugin settings via `getPluginConfig()` (issuer, audience, authorized party, optional JWKS override, clock skew) — nothing hardcoded — and does its OWN OIDC discovery to get `jwks_uri` (the host's `fetchOIDCDiscovery` omits it, which is a point FOR the plugin owning discovery). The existing `auth.providers.keycloak` in `auth.ts` is a different OAuth role: a confidential *login connector* (code→cookie), not a resource-server bearer validator, and it is the Topology-A/legacy path. Resolution: under Topology B the resolver owns the API/WS bearer path; the login connector is never consulted for bearer validation and is not the principal source. When both point at one realm, the resolver's configured `issuer` MUST equal the connector's issuer string exactly — `iss` is the persisted `(iss, sub)` join key, so a hostname/port/scheme mismatch silently breaks every stored key (the issuer-pinning trap). The resolver validates `iss` by exact match, never by logical equivalence.

### D6 — The ticket is the identity bridge to the socket
A browser cannot set an `Authorization` header on a WS upgrade, so the mandatory ticket hop is reused as the identity-injection point: the mint (HTTP, where `request.principal` exists) binds the principal onto the ticket; the upgrade consumes the ticket and copies the principal to `ws.principal`. No new transport is invented.

### D7 — Fan-out by permission, host-owned, predicate plugin-supplied
`broadcast()` for domain events becomes `broadcastToPermitted`: the host iterates candidate sockets and calls a plugin-registered `canSee(principal, resourceId)`, delivering only on `true`. It must be host-side because `registerBrowserHandler` types `ws` as `unknown` and the broadcast function is global — the plugin can supply the decision but only the host can do the targeted send. No predicate ⇒ no delivery (fail-closed). Session-scoped flow frames keep their existing subscription path untouched.

### D8 — Owner-equality on subscribe AND replay
Both the live subscribe and the replay/backlog path compare `ws.principal` to the session owner; a principal-less socket or an ownerless session fails the check. Guarding only subscribe would leave replay as a second leak path.

## Concurrency & multi-user

- **HTTP needs no per-user handling.** `request.principal` is per-request state on the Fastify request object; concurrent requests never share it. The registry and resolvers are stateless per call — each `resolve(authCtx)` is keyed only to that request's headers. The one shared structure, the JWKS cache, holds public keys identical for all users, so sharing is safe and desirable.
- **WS is where multi-user is enforced**, precisely because the socket outlives the request. `ws.principal` (D6) + owner-equality (D8) + permissioned fan-out (D7) are the three mechanisms that keep concurrent users isolated on the long-lived plane. Browser-plane liveness bounds an authenticated socket so it cannot serve a principal past validity.

## Standards alignment

The design was checked against the governing standards and the two reference frameworks; it is not bespoke.

- **Pattern = Spring Security `ProviderManager` + `SecurityContext`.** The priority-ordered resolver chain returning the first non-null claim is `ProviderManager` chaining `AuthenticationProvider`s; `request.principal` is the `SecurityContext`/`Authentication.getPrincipal()` (ASP.NET `ClaimsPrincipal` on `HttpContext.User`; Passport `req.user`). The three-valued result (claim / null / reject) is Spring's return-null-vs-throw-`AuthenticationException`.
- **Curated `AuthContext` is best practice.** Spring hands providers a curated `Authentication` token, not the raw `HttpServletRequest`; passing the raw request into identity logic is the anti-pattern (CWE-639 / OWASP A04 when unverified client input reaches identity/tenant decisions). We pass a bounded allowlist.
- **Resolving in an `onRequest` hook is mainstream** (Spring `BearerTokenAuthenticationFilter`, ASP.NET auth middleware). The "keep app logic out of middleware" guidance is honored by keeping *authorization* (`canSee`, approver routing) OUT of the hook and in the plugin/engine.
- **Governing RFCs for the resource-server (Topology B) path**, implemented by the Keycloak resolver, not core: **RFC 9068** (JWT access-token profile: `iss`/`aud`/`azp`/`exp` + signature), **RFC 9700** (OAuth 2.0 Security BCP 2024 — the decode-without-verify pitfalls), **RFC 10017** (OAuth for browser-based apps — public client + PKCE), and **RFC 9449** (DPoP, the reason `AuthContext` carries `method`/`url`/`dpop`).
- **Acknowledged deviation:** textbook Topology B unifies "authenticated" with "has a principal" in one bearer-validation step. This design keeps the legacy `isAuthenticated` chain first and resolves the principal second, because of the pre-existing paired-device bearer path (the B4 collision). That is why consumers MUST gate on `principal`, never on `isAuthenticated`.

## Risks / Trade-offs

- **Identity/authorization is a new privileged surface** → the `priority <= 100` gate is load-bearing; keep it identical to the spawn gate.
- **Behavioral change from broadcast-to-all** → domain events stop reaching non-owners once principals exist. Mitigation: fail-closed default (no predicate ⇒ no delivery) and a clear cut-over; session-flow frames are unaffected.
- **Hot-path `await` per request** → resolvers must cache; core adds only a tiny sort + first-match short-circuit; zero resolvers is a no-op.
- **Equal-priority nondeterminism** → stable sort within a boot + warning log.
- **Ownership source** → owner-equality assumes sessions carry an owner. Where a session has none (automation/legacy), it is treated as ownerless and excluded from human sockets (fail-closed), never defaulted to a human.

## Migration Plan

Additive; no data migration. Upstream the HTTP seam and WS plumbing to `develop`; with no resolver and no `canSee` predicate registered, HTTP is inert and permissioned events deliver to nobody (safe). Cut over per deployment by registering the default resolver (downstream) and a `canSee` predicate. Roll back by removing the hook, the ticket binding, and reverting `broadcastToPermitted` to the prior broadcast — no persisted state depends on it.

## Open Questions

None affecting these specs, the approach, or the tasks. B4 disambiguation order (JWT-first, device fallback) and JWKS caching are resolver-internal (downstream). How a session's owner is assigned at spawn is a downstream product concern; this change only reads/records an owner and fails closed when absent.
