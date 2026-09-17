## Why

The dashboard cannot safely serve more than one human at once. On the HTTP plane it collapses every caller into a boolean `request.isAuthenticated` with no `(iss, sub)` behind it (and the boolean is even set for a device with no person). On the WebSocket plane it is worse: a socket is authenticated *once* at upgrade by a ticket that records only a route scope and device id — never a user — then goes anonymous, and InvoiceBot domain events are `broadcast()` to **every** connected socket. The observable result is a cross-user leak: Béla's browser receives Anna's invoice events (InvoiceBot `AUTH-FLOW.md` §8).

Per-request principal resolution alone does **not** fix this — it isolates the short-lived HTTP request but leaves the long-lived socket, which is exactly the plane multi-user traffic actually flows over. To make the product multi-user-correct we must carry a real identity onto *both* planes. This change builds the whole identity plane as one upstreamable, IdP-agnostic unit: resolve a principal per request, bind it onto the socket, scope subscriptions and event fan-out to it, and keep an authenticated socket from outliving its principal.

## What Changes

**HTTP plane — principal resolution seam:**
- Add a `Principal` shape `{ iss, sub, email? }`; `(iss, sub)` is the identity key, `email` a label.
- Add a curated `AuthContext` (not the raw request): `{ method, url, authorization?, cookie?, dpop?, isAuthenticated, ip }`. It carries `method`+`url`+`dpop` so a sender-constrained-token (DPoP, RFC 9449) resolver stays possible without a later schema break, while still exposing only a bounded allowlist rather than the raw Fastify request.
- Add `request.principal: Principal | null`, decorated once, defaulting to `null`.
- Add `ctx.registerPrincipalResolver(resolve, priority)` (mirrors `onSessionResolved`), returning an unsubscribe fn.
- Add one core `onRequest` hook after the auth chain that walks resolvers **in priority order** (lower wins) and sets `request.principal` to the first non-null result — first-match-by-priority, fail-closed.
- Resolver contract `async (ctx) => Promise<Principal | ResolverReject | null>`; `null` means "not my credential, continue the chain", a `ResolverReject` means "this credential is mine and it is invalid" (stops the chain, yields no principal, may drive a 401), and a throw/timeout is treated as `null` and logged, never a 500. This mirrors Spring `ProviderManager` (return-null vs throw `AuthenticationException`).
- Registration is trust-gated at `manifest.priority <= 100`; priority does double duty (trust gate + precedence). Equal priorities tie-break by registration order with a warning.

**WebSocket plane — carry the principal onto the socket:**
- **BREAKING (behavioral):** the ws-ticket mint binds the resolved `principal`, not only a route scope + device id.
- Attach `ws.principal = (iss, sub)` at upgrade so the socket stops being anonymous.
- Enforce owner-equality on **subscribe and on replay**: a socket may stream only sessions its principal owns.
- Replace the global `broadcast()` for domain events with `broadcastToPermitted`, driven by a plugin-supplied `canSee(principal, resourceId)` predicate — fan-out by permission, not by bare subscription.
- Add browser-plane liveness: a heartbeat on the browser socket and close-on-session-end, so an authenticated socket cannot outlive its principal's validity (the existing `ws-ping-pong` covers only the bridge plane).

**Default Keycloak resolver plugin — config-seeded, nothing hardcoded:**
- Ship a default resolver plugin that validates a Keycloak JWT bearer as a resource server per RFC 9068: signature via cached JWKS, plus `iss`, `aud`, `azp`, `exp`. It disambiguates a JWT from the opaque paired-device bearer (JWT-first, device fallback) and returns `null` for a device token.
- **Every Keycloak-specific value is seeded from a setting**, read via the existing `getPluginConfig()` — issuer URL (e.g. the Docker `http://keycloak:8080/realms/<realm>`), expected `audience`, `authorizedParty`/client id, optional `jwksUri` override, and clock-skew tolerance. **No issuer, realm, port, client id, or key is hardcoded.** The plugin performs its own OIDC discovery from the configured issuer to obtain `jwks_uri` (it does not depend on core's incomplete `fetchOIDCDiscovery`).

Non-goals (separate downstream changes on `private/invoicebot`): the InvoiceBot-specific `canSee` implementation and product authorization. Session *ownership assignment* at spawn time (stamping `pluginRef:{iss,sub}`) is in scope only as the host-side plumbing that records an owner; product meaning stays downstream.

## Capabilities

### New Capabilities
- `principal-resolution`: Core IdP-agnostic seam resolving an authenticated request to a `(iss, sub)` principal via priority-ordered, trust-gated, fail-closed plugin resolvers, exposed as `request.principal`.
- `websocket-principal-binding`: Carrying the resolved principal from the HTTP mint onto the WebSocket — ticket binds the principal, `ws.principal` attached at upgrade, and browser-plane liveness so an authenticated socket cannot outlive its principal.
- `session-ownership-scoping`: Owner-equality enforcement on both subscribe and replay, so a socket may stream only the sessions its principal owns.
- `permissioned-event-fanout`: A host-owned `broadcastToPermitted` that fans domain events out by a plugin-supplied `canSee(principal, resourceId)` predicate, replacing the global broadcast.
- `keycloak-principal-resolver`: A config-seeded default resolver plugin that validates a Keycloak JWT bearer as a resource server (RFC 9068: JWKS/RS256, `iss`/`aud`/`azp`/`exp`), disambiguates it from the opaque device bearer, and reads every Keycloak connection value from settings — hardcoding nothing.

### Modified Capabilities
<!-- None. New behavior composes WITH existing specs rather than changing their
     requirements: ws-frame-delivery-policy (delivery class / shedding) is orthogonal
     to WHO may receive; ws-ping-pong governs the bridge plane, not the browser plane;
     session-identity's "owner" is bridge-routing ownership, not human principal. -->

## Impact

- **Code**: `packages/server/src/server.ts` (decorate `request.principal`; resolver-walk `onRequest` hook ~1404; `registerPrincipalResolver` on plugin context ~2266; ws-ticket mint ~1785; WS upgrade validate ~2643). `browser-gateway.ts` (`subscriptions`, `broadcast()` → `broadcastToPermitted`, owner check on subscribe/replay, browser-plane heartbeat). `ws-ticket.ts` (bind principal on the ticket). Shared types with `dashboard-plugin-runtime`.
- **Composes with (not modifying)**: `ws-frame-delivery-policy`, `ws-ping-pong` (bridge plane), `plugin-ws-route`, `session-identity`.
- **Conflict with the existing dashboard Keycloak (`auth.providers.keycloak`, `auth.ts`)**: that integration is a *login connector* — a confidential client doing code→cookie exchange whose `fetchOIDCDiscovery` omits `jwks_uri`/`end_session_endpoint`; it is NOT a resource-server bearer validator and is the Topology-A/legacy path (mints its own 7-day cookie, Keycloak out of loop). The new `keycloak-principal-resolver` is a *resource server* validating the bearer per request. Both may point at the same realm, so the resolver's configured `issuer` MUST equal the login connector's issuer (the `iss` value is the persisted join key — a hostname/port mismatch silently breaks every stored key). Resolution: the resolver owns the API/WS bearer path via its own plugin config (seeded, `getPluginConfig()`); the login connector is not consulted for bearer validation and is not the source of the principal.
- **APIs**: new `ctx.registerPrincipalResolver`; new `request.principal` and `ws.principal`; new host `broadcastToPermitted` + plugin `canSee` predicate registration. No existing signature removed.
- **Behavior**: HTTP seam is default-inert (no resolver ⇒ `principal` always `null`). The WS fan-out change is behavioral: once principals exist, domain events stop reaching non-owners — the intended multi-user fix, but a visible change from today's broadcast-to-all.
- **Security**: introduces the identity plane; the `priority <= 100` trust gate is load-bearing (a resolver can mint any principal). Consumers gate on `principal`, never on `isAuthenticated`. Fail-closed default also disposes of ownerless/automation sockets (no principal ⇒ excluded from every human subscriber).
- **Upstream carve-out**: this whole plane is generic identity plumbing naming no product concept, so it upstreams to `develop`; the Keycloak resolver and InvoiceBot `canSee` stay downstream.
