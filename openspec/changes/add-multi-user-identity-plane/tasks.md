## 1. Types and shared contract

- [ ] 1.1 Add `Principal` (`{ iss: string; sub: string; email?: string }`) and the DPoP-ready `AuthContext` (`{ method: string; url: string; authorization?: string; cookie?: string; dpop?: string; isAuthenticated: boolean; ip: string }`) to a core module shared with `dashboard-plugin-runtime`; verify both packages type-check against the shared import.
- [ ] 1.2 Add `ResolverReject` (a distinct sentinel/type), `PrincipalResolverFn = (ctx: AuthContext) => Promise<Principal | ResolverReject | null>`, `registerPrincipalResolver(resolve, priority) => () => void`, and `CanSeeFn = (principal: Principal, resourceId: string) => boolean` with `registerCanSee(fn) => () => void` to the plugin-context type; verify `tsc` passes and that `Principal`, `ResolverReject`, and `null` are distinguishable at the type level.

## 2. Principal resolver registry (HTTP plane)

- [ ] 2.1 Implement a module-level resolver registry (`{ pluginId, priority, registrationIndex, resolve }`) with add + unsubscribe; verify a unit test that add-then-unsubscribe leaves it empty.
- [ ] 2.2 Implement `sortedResolvers()` ordered by `(priority asc, registrationIndex asc)` and a one-time warning on shared priority; verify a unit test asserts stable ordering and captures the collision warning without throwing.

## 3. Request-time resolution hook (HTTP plane)

- [ ] 3.1 Add `fastify.decorateRequest("principal", null)` at the single decoration site next to `isAuthenticated` (server.ts:~1397); verify the server boots without a duplicate-decorator throw.
- [ ] 3.2 Build the curated DPoP-ready `AuthContext` (`method`, `url`, authorization/cookie/dpop headers, `isAuthenticated`, `ip`) from the request in a pure helper; verify a unit test maps a sample request to the expected shape and exposes nothing beyond the allowlist.
- [ ] 3.3 Register one core `onRequest` hook after `registerAuthPlugin` (server.ts:~1404) that walks `sortedResolvers()`, sets `request.principal` to the first `Principal` result and short-circuits; on a `ResolverReject` stop the walk with `request.principal === null` (and enable a 401), on `null` continue; verify an integration test that a lower-priority-number resolver wins, a `ResolverReject` stops the chain fail-closed, and the higher one is not invoked after a claim.
- [ ] 3.4 Wrap each resolver in try/catch + a time budget; throw/reject/timeout ⇒ treated as `null`, logged, never a 500; verify tests for a throwing and a slow resolver both yield `request.principal === null` with a normal response.
- [ ] 3.5 Expose `registerPrincipalResolver` on the plugin context (server.ts:~2266) gated at `priority <= 100` with a no-op registrar otherwise; verify a test that a `>100` plugin's resolver never runs and a `<=100` plugin's does, registered before `listen()`.

## 4. Ticket binds the principal (WS plane)

- [ ] 4.1 Extend the ws-ticket record and mint (server.ts:~1785, `ws-ticket.ts`) to bind `request.principal` when present (scope + deviceId retained, single-use + short-TTL unchanged); verify a unit test that a mint with a principal records it and a mint without one records none.
- [ ] 4.2 On WS upgrade consume (server.ts:~2643), copy the ticket's principal to `ws.principal`; verify an integration test that a principal-bound ticket yields `ws.principal` set and a principal-less ticket yields `ws.principal === null`.

## 5. Owner-scoped subscription and replay (WS plane)

- [ ] 5.1 Add an owner-equality check comparing `ws.principal` to the session owner on the subscribe path in `browser-gateway.ts`; verify tests that owner is accepted, non-owner refused, principal-less socket refused an owned session.
- [ ] 5.2 Apply the identical check on the replay/backlog path; verify a test that a non-owner replay is refused with no historical frames.
- [ ] 5.3 Treat an ownerless session as owned by nobody; verify a test that a principal-bearing socket cannot subscribe to an ownerless session.

## 6. Permissioned fan-out (WS plane)

- [ ] 6.1 Add host-owned `broadcastToPermitted(event, resourceId)` iterating sockets and calling a registered `canSee(ws.principal, resourceId)`, delivering only on `true`; verify a two-socket test (Anna owns, Béla does not) that only Anna receives the event.
- [ ] 6.2 Register the plugin `canSee` predicate (gated `priority <= 100`); with no predicate registered, permissioned events deliver to nobody (fail-closed); verify a test for the no-predicate case and a principal-less socket receiving nothing.
- [ ] 6.3 Replace the domain-event `broadcast()` call site with `broadcastToPermitted`, leaving session-scoped flow-frame delivery on its existing subscription path; verify a test that flow frames still reach subscribers unchanged.

## 7. Browser-plane liveness (WS plane)

- [ ] 7.1 Add a browser-plane heartbeat (distinct from bridge ping/pong) that terminates a socket failing to answer within the window and releases its subscriptions; verify a test simulating a missed heartbeat closes the socket.
- [ ] 7.2 Close a browser socket when its underlying session ends; verify a test that session-end triggers socket close rather than leaving it streaming.

## 8. Default Keycloak resolver plugin (config-seeded)

- [ ] 8.1 Declare the plugin config schema (issuer URL required; audience, authorizedParty/clientId, jwksUri override, clockSkew optional) and read it via `getPluginConfig()`; verify a test that with no issuer configured the resolver registers but resolves every request to `null` (inert, no hardcoded fallback).
- [ ] 8.2 Implement OIDC discovery from the configured issuer to obtain `jwks_uri` (or use the override) and a JWKS cache with refresh-on-unknown-kid; verify a test that a second request validates against cached keys with no network fetch and an unknown kid triggers one refresh.
- [ ] 8.3 Implement RFC 9068 validation (RS256 signature, exact `iss` match, `aud` includes configured audience, `azp` equals configured party when set, `exp` within clock skew) returning `{ iss, sub, email? }` on success and `ResolverReject` on an owned-but-invalid JWT; verify tests for a valid token → principal and a bad-signature/expired token → reject.
- [ ] 8.4 Implement JWT-first disambiguation: a non-JWT (opaque device) bearer returns `null` and falls through; verify a test that an opaque device token yields `null` and never a principal, and that a mismatched `iss` yields `ResolverReject`.
- [ ] 8.5 Register the resolver at the default (high-number/low-trust-precedence) priority so an override plugin can pre-empt it; verify a test that a lower-priority-number override wins over the default.

## 9. Validation and cross-cutting

- [ ] 9.1 Verify default-inert: with the Keycloak resolver unconfigured and no `canSee` predicate, every request has `request.principal === null`, HTTP behavior is unchanged, and permissioned events deliver to nobody.
- [ ] 9.2 End-to-end multi-user test: two principals (from real seeded Keycloak logins) over concurrent HTTP + WS get isolated principals, and one user's domain events never reach the other's socket (subscribe, replay, and fan-out).
- [ ] 9.3 Verify the issuer-pinning conflict guard: a token whose `iss` does not exactly match the configured issuer is rejected, and document that the resolver issuer MUST equal any `auth.providers.keycloak` login-connector issuer.
- [ ] 9.4 Run `openspec validate add-multi-user-identity-plane --strict` and confirm it passes.
- [ ] 9.5 Add a doc note: consumers MUST gate on `request.principal`/`ws.principal`, never `isAuthenticated`; the generic seam upstreams to `develop`; nothing about Keycloak is hardcoded (all seeded via `getPluginConfig()`); verify the note links the five specs and cites RFC 9068/9700/10017/9449.
