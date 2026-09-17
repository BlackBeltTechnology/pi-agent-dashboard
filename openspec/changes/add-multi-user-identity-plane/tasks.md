## 1. Types and shared contract

- [ ] 1.1 Add immutable `Principal` (`{ iss; sub; email? }`), `PrincipalResolution` (`{ principal; expiresAt }`), `ResolverReject`, and DPoP-ready `AuthContext` (`{ method; url; authorization?; cookie?; dpop?; isAuthenticated; ip }`) to a core module shared with `dashboard-plugin-runtime`; verify both packages type-check.
- [ ] 1.2 Add `PrincipalResolverFn = (ctx: AuthContext) => Promise<PrincipalResolution | ResolverReject | null>` plus `HostAction`, `HostResource`, and `HostAccessPolicyFn = (input: { principal; action; resource }) => Promise<boolean>`; verify the three resolver outcomes and the policy boolean are type-distinguishable.
- [ ] 1.3 Add `identity` config shape (`mode: legacy|multi-user`; `trustedResolverPlugins: string[]`; `trustedPolicyPlugin?: string`; resolver/policy timeouts) to shared config; verify default parse yields `mode: legacy`.

## 2. Identity mode and startup readiness

- [ ] 2.1 Thread `identity.mode` (default `legacy`) through config load; verify a test that an absent `identity` block resolves to legacy.
- [ ] 2.2 Add a pre-`listen()` readiness check: in multi-user mode require a configured resolver and exactly one trusted policy; fail startup on missing resolver, zero policies, or duplicate policies; verify tests for each failure and the happy path.
- [ ] 2.3 In multi-user mode reject a non-empty `auth.providers` (confidential login connectors) as a config error; verify a test that mixed mode fails startup and legacy mode leaves connectors intact.

## 3. Resolver registry with host trust grant

- [ ] 3.1 Implement a resolver registry keyed by `pluginId`, ordered `(manifest.priority asc, pluginId asc)`; duplicate registration from one plugin fails; verify a unit test of deterministic cross-boot ordering.
- [ ] 3.2 Gate `registerPrincipalResolver` on the host trust grant (bundled resolver or a plugin named in `identity.trustedResolverPlugins`); a self-declared `manifest.priority` grants nothing; verify a test that an untrusted plugin gets a no-op registrar and a low-priority-but-untrusted plugin still cannot register.
- [ ] 3.3 Validate/copy/freeze resolver output before exposure (reject empty `iss`/`sub`, non-future/absent `expiresAt`, non-plain shapes, over-length); verify a test that a malformed principal is discarded and logged.

## 4. Resolution integrated into the auth gate (HTTP plane)

- [ ] 4.1 Decorate `request.principal` (null) and `request.principalExpiresAt` (null) once, next to `isAuthenticated` (server.ts:~1397); verify boot without a duplicate-decorator throw.
- [ ] 4.2 Build the curated `AuthContext` in a pure helper (method, canonical url, authorization/cookie/dpop, isAuthenticated, ip); verify a unit test exposes nothing beyond the allowlist.
- [ ] 4.3 Register the resolver-dispatch `onRequest` hook AFTER `registerBearerAuth` and BEFORE `registerAuthPlugin`, so a valid bearer authenticates before the cookie hook can reject; a claim sets principal + expiry + `isAuthenticated`; a reject returns 401; `null` continues; verify an integration test that a Keycloak-bearer request with no cookie is authenticated (not 401'd) and a reject returns 401.
- [ ] 4.4 Bound each resolver by the configured timeout; throw/reject/timeout ⇒ `null`, logged, never a 500; verify tests for a throwing and a slow resolver.
- [ ] 4.5 Verify the device-bearer path still yields `isAuthenticated` true with `principal === null` (no resolver claims a device token).

## 5. Bundled Keycloak resolver (config-seeded, in-dashboard)

- [ ] 5.1 Declare the config schema (`issuer`, `audience` required; `authorizedParty`, `jwksUri`, `clockSkewSeconds`, `networkTimeoutMs`, `allowInsecureHttp` optional) read via `getPluginConfig()`; verify a test that with no issuer/audience it resolves every request to `null` and never substitutes a default; `http:` without `allowInsecureHttp` is inert.
- [ ] 5.2 Implement OIDC discovery + JWKS cache with coalesced refresh and single-refresh-per-unknown-kid, bounded by `networkTimeoutMs`; verify a test that a second request hits cache and a discovery outage denies (rejects owned tokens) rather than accepting unverified.
- [ ] 5.3 Implement ownership disambiguation: opaque/non-JWT ⇒ `null`; JWT with foreign unverified `iss` ⇒ `null`; JWT claiming the configured issuer ⇒ owned; verify tests for all three.
- [ ] 5.4 Implement RFC 9068 validation on owned tokens (RS256 only, signature, exact `iss`, required `aud`, optional `azp`, `exp`, `sub`) returning `{ principal, expiresAt }`; failure ⇒ reject; `email` only when `email_verified`; verify tests incl. an `alg:none`/non-RS256 rejection.
- [ ] 5.5 Validate the DPoP proof when `cnf.jkt` is present: proof JWS signature under embedded `jwk`, thumbprint == `cnf.jkt`, `htm`, canonical `htu` (query/fragment stripped, scheme/host from configured base/proxy), `ath` == b64url SHA-256 of the access token, fresh `iat`, unreused `jti` (single-instance LRU); missing/unsigned/any-mismatch ⇒ reject; token without `cnf.jkt` validates as a plain bearer; verify tests for a proof-without-`ath`-binding rejection and a bound-token-without-proof rejection.
- [ ] 5.6 Ensure the resolver catches its own crypto/JWKS/DPoP faults on an owned token and returns `reject` (never an uncaught throw that core would coerce to `null`); verify a test that an induced validation fault on an owned token yields `reject`, not fall-through.

## 6. Session ownership (persist + assign)

- [ ] 6.1 Add `principalOwner?: { iss; sub }` to `SessionMeta`/`DashboardSession` and surface it on summaries; equality is exact field comparison; verify a persistence round-trip test.
- [ ] 6.2 Stamp owner on trusted spawn roads only: browser `spawn_session` (socket principal), host HTTP spawn (request principal), trusted owned-spawn API (passed principal); an untrusted plugin's owner field is ignored; automation/legacy stay ownerless; verify tests for each road.

## 7. Host access policy + classification

- [ ] 7.1 Accept exactly one `authorize()` from the `identity.trustedPolicyPlugin`; refuse any other registrant; verify tests for the named plugin accepted and a non-named plugin refused.
- [ ] 7.2 Bound each policy call (default 500ms); missing/false/throw/timeout/non-boolean ⇒ deny + structured audit event; verify tests for timeout-denies and non-boolean-denies.
- [ ] 7.3 Add identity metadata to every core HTTP route (`public`|`device`|protected `{action, resource}`) and require it on protected plugin routes; unclassified protected `/api` route in multi-user mode denies; verify a coverage test that an unclassified protected route fails.
- [ ] 7.4 Map every browser WS bootstrap frame and inbound message type to a classification; unknown protected message denies in multi-user mode; verify a coverage test over the message table.

## 8. Enforce every session read/write road (HTTP + WS)

- [ ] 8.1 Enforce owner-equality on HTTP session detail/transcript/mutation routes; verify non-owner and principal-less are refused, owner accepted.
- [ ] 8.2 Filter WS bootstrap session snapshot + list/pagination per item (only owned sessions); verify a two-principal test that each sees only its own sessions, never the full registry.
- [ ] 8.3 Enforce owner-equality on subscribe, replay/backfill, and every inbound session command (prompt/abort/retry/kill/rename/archive/metadata); verify a non-owner is refused identically on each road.
- [ ] 8.4 Route non-session bootstrap/global commands (OpenSpec, branch, terminal, system) through the policy; verify bootstrap omits unauthorized workspace/terminal state and a global command is policy-gated.

## 9. WebSocket identity binding + lifetime

- [ ] 9.1 Bind `principal` + `expiresAt` onto the ticket at mint (server.ts:~1785, `ws-ticket.ts`); a principal-less request records none; verify a mint test.
- [ ] 9.2 In multi-user mode require an identity-bearing ticket for browser upgrades; cookie/local-token/trusted-network/no-ticket browser upgrades are refused (server.ts:~2643); non-browser scopes unchanged; verify tests for cookie-only and trusted-network refusal.
- [ ] 9.3 Attach immutable `ws.principal` + `ws.principalExpiresAt` at upgrade; verify principal-bound vs principal-less tickets.
- [ ] 9.4 Close a browser socket at `principalExpiresAt`; verify a test that expiry closes the socket and releases subscriptions.
- [ ] 9.5 Add a transport-only browser heartbeat (distinct from bridge ping/pong, not tied to a single session); verify a missed-heartbeat close and that heartbeats do NOT extend identity past expiry.

## 10. Permissioned domain-event fan-out

- [ ] 10.1 Replace the global domain-event `broadcast()` with a host-owned targeted send that calls the access policy per candidate socket in multi-user mode; deliver only on `true`; principal-less socket gets nothing; verify a two-socket isolation test.
- [ ] 10.2 Preserve legacy-mode global broadcast unchanged and leave session-scoped flow frames on their owner-gated subscription road; verify a legacy-broadcast test and a flow-frame test.
- [ ] 10.3 Classify each frame as exactly one road at emit (session-scoped-by-`sessionId` vs global-domain-by-`resource`); an undeclared frame type is treated as a protected domain event (policy-gated, fail-closed), never broadcast; verify a test that an unknown frame type is not globally delivered.

## 11. Validation and cross-cutting

- [ ] 11.1 Verify legacy default-inert: with `identity.mode` unset, every HTTP/WS/bootstrap/command/broadcast outcome is identical to before the change.
- [ ] 11.2 Docker-harness E2E: real seeded Keycloak (Anna, Béla), Authorization Code + PKCE login, two-user HTTP + WS isolation across bootstrap, list, detail, subscribe, replay, command, and domain-event fan-out; a non-owner reaches none of Anna's sessions or events.
- [ ] 11.3 Verify issuer pinning: a token whose `iss` differs from the configured issuer is rejected; document that issuer host/scheme/port must be pinned before any `(iss, sub)` ownership is persisted.
- [ ] 11.4 Run `openspec validate add-multi-user-identity-plane --strict` and confirm it passes.
- [ ] 11.5 Add a doc note: consumers gate on `request.principal`/`ws.principal`, never `isAuthenticated`; the whole plane ships on `develop` with the Keycloak resolver bundled in-dashboard and fully config-seeded; product authorization lives behind the single access-policy seam; cite RFC 9068/9700/10017/9449.

_(Scenarios from `scenario-design` fold into §8/§10/§11 as they are drafted.)_
