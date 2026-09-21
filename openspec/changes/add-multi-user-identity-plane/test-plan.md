# Test Plan — add-multi-user-identity-plane

Adversarial, real-life scenarios derived from the seven specs. Stage: `apply` (soft gate). Each row is a Triple (INPUT / TRIGGER / OBSERVABLE) with a level and disposition. `[NEEDS CLARIFICATION]` markers, if any, are surfaced in the banner.

**Activation vocabulary:** there is no mode flag. "Active" = the bundled `keycloak-resolver` plugin is enabled AND configured (issuer+audience). "Inert" = disabled or unconfigured (byte-for-byte today). The host access policy is OPTIONAL and gates only non-session roads; session roads are owner-gated whenever the resolver is active.

**Clarification markers:** none blocking — the two deferred items (cross-instance `jti` replay; ownerless-session adoption) are explicit non-goals in design.md, not gaps.

Levels: **L1** unit (`packages/*/src/**/__tests__/*.test.ts`, vitest) · **L2** smoke (`qa/tests/*.sh`, no rendered-UI) · **L3** e2e (`tests/e2e/*.spec.ts`, Playwright vs docker harness, port from `.pi-test-harness.json`).

---

## Principal resolution (HTTP gate)

| # | Class | Technique | Level | Disp. | INPUT → TRIGGER → OBSERVABLE |
|---|---|---|---|---|---|
| PR-1 | edge | state-transition | L1 | automated | Valid Keycloak bearer, no cookie → request hits gate → `request.principal` set, `isAuthenticated` true, response is the route's, NOT 401 (proves dispatch runs before the cookie hook). |
| PR-2 | error | state-transition | L1 | automated | Owned JWT, bad signature → resolver reject → chain stops, 401 returned, no lower resolver consulted. |
| PR-3 | edge | decision-table | L1 | automated | Foreign-issuer JWT → resolver returns null → next resolver consulted (not rejected). |
| PR-4 | edge | boundary | L1 | automated | Two resolvers equal priority, plugin ids `b`,`a` → sorted → `a` runs first, identical across two boots (deterministic tie-break). |
| PR-5 | error | fault-injection | L1 | automated | Resolver throws → treated as null, logged, request continues, never 500. |
| PR-6 | perf | threshold | L1 | automated | Resolver sleeps 3s, budget 2s → treated as null at 2s±, walk continues; p95 gate overhead < 5ms with zero resolvers. |
| PR-7 | edge | boundary | L1 | automated | Resolver returns `{iss:'x',sub:'',expiresAt:...}` → validation discards (empty sub), logged, `principal` null. |
| PR-8 | edge | boundary | L1 | automated | Resolution `expiresAt` = now−1s → treated invalid, no principal. |
| PR-9 | edge | state | L1 | automated | Resolver enabled but unconfigured (no issuer/audience) → dispatch makes no claim; `principal` null, `isAuthenticated` exactly the pre-change chain's value. |
| PR-10 | edge | decision-table | L1 | automated | Untrusted plugin (not in `trustedResolverPlugins`, priority 5) registers → no-op registrar, resolver never runs. |
| PR-11 | edge | state | L1 | automated | Device paired-bearer, no JWT resolver claim → `isAuthenticated` true, `principal` null (device is not a person). |

## Keycloak resolver (config-seeded, RFC 9068 + DPoP)

| # | Class | Technique | Level | Disp. | INPUT → TRIGGER → OBSERVABLE |
|---|---|---|---|---|---|
| KC-1 | edge | EP | L1 | automated | No issuer/audience configured → every request resolves null, no hardcoded default used. |
| KC-2 | error | decision-table | L1 | automated | `http:` issuer, `allowInsecureHttp` false → resolver inert (null); with flag true → operates. |
| KC-3 | edge | decision-table | L1 | automated | Opaque non-JWT bearer → null; JWT foreign iss → null; JWT own iss invalid → reject (three-way). |
| KC-4 | error | boundary | L1 | automated | Owned token `alg:none` / non-RS256 → reject, never accepted unverified. |
| KC-5 | edge | state | L1 | automated | First request fetches JWKS; second validates from cache with no network; unknown `kid` → exactly one coalesced refresh. |
| KC-6 | error | fault-injection | L1 | automated | JWKS/discovery unreachable within timeout, no cached key → owned tokens rejected (deny, not accept). |
| KC-7 | edge | decision-table | L1 | automated | `email_verified` false → returned principal has no `email`; true → `email` present as label. |
| KC-8 | error | boundary | L1 | automated | Token `cnf.jkt` present, `dpop` header absent → reject. |
| KC-9 | error | boundary | L1 | automated | DPoP proof well-formed but `ath` ≠ SHA-256(access token) → reject (proof not bound to this token). |
| KC-10 | error | fault-injection | L1 | automated | Induced crypto fault on an owned token → resolver returns reject (caught), not an uncaught throw → null fall-through. |
| KC-11 | edge | boundary | L1 | automated | Token `iss` differs from configured issuer by trailing slash / port → reject (exact match, issuer pinning). |
| KC-12 | error | decision-table | L2 | automated | Resolver active + non-empty `auth.providers` → startup fails before listen; resolver inert → connectors intact. |

## WebSocket principal binding + lifetime

| # | Class | Technique | Level | Disp. | INPUT → TRIGGER → OBSERVABLE |
|---|---|---|---|---|---|
| WS-1 | edge | state | L1 | automated | Principal-bearing request mints ticket → ticket records `(iss,sub)`+`expiresAt`, single-use, short-TTL. |
| WS-2 | edge | state-transition | L3 | automated | Resolver active, browser upgrade with cookie only, no ticket → upgrade refused. |
| WS-3 | edge | state-transition | L3 | automated | Resolver active, browser on trusted network, no ticket → upgrade refused (bypass does not apply). Resolver inert → upgrade unchanged. |
| WS-4 | edge | state | L1 | automated | Principal-bound ticket consumed → `ws.principal` + `ws.principalExpiresAt` set, immutable. Principal-less ticket → `ws.principal` null. |
| WS-5 | edge | state-transition | L1 | automated | Socket reaches `principalExpiresAt` → socket closed, subscriptions released. |
| WS-6 | frontend-quirk | state-convergence | L3 | automated | Socket answers heartbeats past expiry → still closed at expiry (liveness ≠ identity renewal). |
| WS-7 | error | fault-injection | L1 | automated | Browser socket misses heartbeat window → terminated, subscriptions released. |

## Session ownership scoping

| # | Class | Technique | Level | Disp. | INPUT → TRIGGER → OBSERVABLE |
|---|---|---|---|---|---|
| SO-1 | edge | state | L1 | automated | Session persisted with owner → `.meta.json` + summary expose `principalOwner`; round-trips. |
| SO-2 | edge | decision-table | L1 | automated | Owner assignment: browser spawn (socket principal) / HTTP spawn (request principal) / trusted owned-spawn (passed) → set; untrusted plugin owner field → ignored; automation → ownerless. |
| SO-3 | edge | decision-table | L1 | automated | Non-owner principal → refused on subscribe, replay, HTTP detail, and each session command, identically. |
| SO-4 | edge | boundary | L1/L3 | automated | Two principals, N sessions each → list/page returns only own items, never the full registry (per-item filter). |
| SO-5 | edge | state | L1 | automated | Principal-less socket vs owned session → refused every road. |
| SO-6 | edge | state | L1 | automated | Ownerless (automation) session vs principal-bearing socket → owner-equality fails, refused. |
| SO-7 | error | boundary | L1 | automated | Owner comparison with `iss` equal, `sub` differing only in case → NOT equal (exact, no normalization). |

## Host access policy + classification

| # | Class | Technique | Level | Disp. | INPUT → TRIGGER → OBSERVABLE |
|---|---|---|---|---|---|
| AP-1 | error | decision-table | L2 | automated | No `trustedPolicyPlugin` named → boots, non-session roads ungated; named-but-absent → startup fails; two policies → startup fails; exactly one → boots. |
| AP-2 | error | fault-injection | L1 | automated | Policy times out (>configured) / throws / returns non-boolean → deny + structured audit event each. |
| AP-3 | edge | boundary | L1 | automated | Policy registered + unclassified non-session road on the policy path → denied fail-closed; no policy → same road ungated (as today). |
| AP-4 | edge | boundary | L1 | automated | Session road (owner-gated) needs no policy: non-owner refused, owner accepted, with zero policy plugins registered. |
| AP-5 | edge | coverage | L1 | automated | Add a session road without an owner-equality check → session-road coverage test fails (meta-test). |
| AP-6 | edge | state | L1 | automated | Policy registered + unknown non-session WS message type on the policy path → refused; no policy → unchanged. |
| AP-7 | edge | state | L3 | automated | Principal connects with a policy registered → bootstrap includes only owned sessions and only policy-permitted workspace/terminal/system state (no other user's paths/branches/terminals). |
| AP-8 | edge | state | L1 | automated | Only the `trustedPolicyPlugin`-named plugin can register `authorize`; another registrant refused. |

## Permissioned fan-out

| # | Class | Technique | Level | Disp. | INPUT → TRIGGER → OBSERVABLE |
|---|---|---|---|---|---|
| FO-1 | edge | decision-table | L1/L3 | automated | Anna + Béla sockets, domain event for Anna's resource, policy registered → only Anna receives; Béla does not; principal-less socket does not. |
| FO-2 | error | fault-injection | L1 | automated | Policy throws/times out for a candidate socket → event not delivered to it, denial logged. |
| FO-3 | edge | state | L1 | automated | No policy registered → global broadcast unchanged (byte-for-byte prior behavior). |
| FO-4 | edge | state | L1 | automated | Session-scoped flow frame → delivered via owner-gated subscription road, NOT the policy road. |
| FO-5 | edge | boundary | L1 | automated | Undeclared frame type at emit → treated as a domain event (policy-gated when a policy exists, else ungated), never as an owner-scoped session frame. |

## Browser client plane (topology B)

| # | Class | Technique | Level | Disp. | INPUT → TRIGGER → OBSERVABLE |
|---|---|---|---|---|---|
| BC-1 | edge | state | L1 | automated | Client runs PKCE → access token held in memory, never written to `localStorage`; token exchange sends a code verifier and no client secret. |
| BC-2 | edge | state | L1 | automated | Same-origin `/api` request with a token → carries `Authorization: Bearer`; a request with an explicit `Authorization` header → not overridden. |
| BC-3 | edge | state | L3 | automated | Resolver active, unpaired human browser (re)connects → client mints a fresh single-use ws-ticket via the bearer, presents only `?ticket=`, token never on the WS URL. |
| BC-4 | frontend-quirk | state-transition | L3 | automated | Socket closes at `principalExpiresAt` → client re-acquires a token, mints a new ticket, reconnects. |
| BC-5 | edge | decision-table | L1 | automated | Token with `cnf.jkt` → client attaches a DPoP proof per REST call + ticket mint; unbound token → no proof, REST still succeeds (config-free downgrade). |
| BC-6 | edge | state | L1/L3 | automated | Inert dashboard → client runs no PKCE, attaches no bearer, mints no ticket (today's UX). |

## End-to-end (real Keycloak, two users)

| # | Class | Technique | Level | Disp. | INPUT → TRIGGER → OBSERVABLE |
|---|---|---|---|---|---|
| E2E-1 | integration | scenario | L3 | automated | Seeded realm (Anna, Béla), Authorization Code + PKCE login → each obtains a token, dashboard validates it, `(iss,sub)` distinct. |
| E2E-2 | integration | scenario | L3 | automated | Anna + Béla concurrent HTTP+WS → Béla reaches none of Anna's sessions across bootstrap, list, detail, subscribe, replay, command, and domain-event fan-out. |
| E2E-3 | edge | state | L3 | automated | Inert default (resolver unconfigured) → current dashboard behavior identical (regression guard). |
| E2E-4 | perf | soak | L2 | manual-only | JWKS hot-path under sustained active-resolver load — measure resolver p95; threshold TBD by deployment. Disposition manual until a perf harness exists. |

## Browser login gate (D16 — detachable; core routes, trusted plugin owns OIDC)

| # | Class | Technique | Level | Disp. | INPUT → TRIGGER → OBSERVABLE |
|---|---|---|---|---|---|
| LG-1 | edge | decision-table | L1 | automated | Resolver active + trusted + server plugin registered `browserClientId` → `GET /api/identity/login-config` (no auth) → `{active:true, issuer(browser-reachable), clientId}`. |
| LG-2 | edge | decision-table | L1 | automated | Resolver inert, OR active but no `browserClientId` registered → `GET /api/identity/login-config` → `{active:false}`, no `issuer`/`clientId` field disclosed. |
| LG-3 | error | state | L1 | automated | Unauthenticated browser on a NON-trusted network → `GET /api/identity/login-config` → admitted by the network guard (path in `PUBLIC_IN_NAMESPACE_PATHS`), route runs, NOT `403 network_not_allowed`. |
| LG-4 | edge | state | L1 | automated | Resolver server plugin calls `registerBrowserLoginConfig({issuer,clientId})` → endpoint relays that descriptor → core module contains no read of `plugins["keycloak-resolver"].*` / no OIDC import (I1 grep-guard). |
| LG-5 | edge | decision-table | L1 | automated | Untrusted plugin (not in `trustedResolverPlugins`) claims `login-provider` at HIGHER manifest priority than the trusted resolver → selection → core mounts only the trusted resolver's provider, ignores the untrusted higher-priority claim. |
| LG-6 | edge | boundary | L1 | automated | Manifest `login-provider` claim with non-empty `component` → validator accepts; same claim with missing/empty `component` → `ManifestValidationError` naming plugin id + slot. |
| LG-7 | edge | state | L1 | automated | Sole `login-provider` plugin disabled in config → pre-App mount applies the enabled filter → `/callback` and start-gate render nothing, no gate (I2/I8 pre-shell). |
| LG-8 | frontend-quirk | state-transition | L1 | automated | Resolver active, no live token, trusted provider → start phase → fetches login-config, builds PKCE-S256 authorize URL, persists {verifier,state,returnTo} to `sessionStorage`, `location.assign`s the authorize URL. |
| LG-9 | frontend-quirk | state-transition | L3 | automated | `/callback?code&state` with matching state, stashed `returnTo="/session/abc"` → callback phase → `exchangeCode`→`setAccessToken`(memory)→ core client-side `navigate("/session/abc",{replace:true})`. |
| LG-10 | error | state-transition | L1 | automated | `/callback` `state` ≠ stashed state → no `exchangeCode` call, no token stored. |
| LG-11 | error | state-transition | L1 | automated | Gate completes + mints a token, host still refuses (aud/`azp`/skew) → core calls `clearAccessToken()`, shows error + manual sign-in affordance, NO automatic re-redirect (no loop). |
| LG-12 | edge | EP+boundary | L1 | automated | Stashed `returnTo` ∈ {`https://evil.com/x`, `//evil.com`, `/\evil.com`, `/callback`, `/auth/login`} → each resolves against origin → core navigates to `/` (open-redirect + recursion rejected). |
| LG-13 | error | state | L1 | automated | `/callback` runs but persisted {verifier,state,returnTo} absent (private mode / cross-origin landing) → no exchange, manual affordance on `/`, no error, no auto-redirect. |
| LG-14 | error | state | L1 | automated | `/callback?error=access_denied` (IdP-declined, RFC 6749 §4.1.2.1) → no exchange → message + link to `/`. |
| LG-15 | error | state | L3 | automated | `/callback` arrives after the plugin was disabled / trust list edited mid-flight (no trusted+active provider mounted) → core renders a safe fallback (message + link to `/`), never blank route or crash. |
| LG-16 | edge | state | L1 | automated | Resolver active + no token, single page load → at most ONE automatic redirect to the issuer; a manual sign-in affordance is always present. |
| LG-17 | edge | decision-table | L1 | automated | Two trusted resolvers A,B active; login-config carries owning `pluginId=A` → core renders A's `login-provider` component (matched by pluginId), never B's component against A's issuer/clientId. |
| LG-18 | frontend-quirk | state-transition | L3 | automated | Resolver active + trusted `login-provider` present, socket → `auth_required` → the reconciled control invokes the new gate; the legacy `/auth/login?return=` link is NOT rendered. |
| LG-19 | edge | state | L1 | automated | Realm issues a `cnf.jkt`-bound token through the gate → gate stores a plain bearer and persists NO DPoP key across the full-page redirect (DPoP-bound browser login is the documented non-goal, B4). |
| LG-20 | integration | scenario | L3 | automated | Real Keycloak (seeded anna) + real browser → open deep link `/session/x` → gate → Keycloak login → `/callback` → token → lands authenticated back on `/session/x` (full PKCE round-trip, opt-in real-Keycloak harness). |

---

**New infra needed (tasks §11.2, built in THIS repo):** the L3 rows require a docker E2E harness with a seeded Keycloak container (realm with Anna/Béla, roles identity-only), a fixture trusted policy plugin (for AP/FO/E2E-2 fan-out rows), and a token-minting test helper. The invoice-bot realm JSON exists in the other repo but no container runs here and it needs reseeding to drop group-based routing; that harness addition is a prerequisite for the L3 rows.

**Fold target:** these rows fold into tasks §4–§12 (unit/L1 into their feature groups; L3 into §11.2; BC-* into §12; AP-5 session-road meta-test into §8; AP/FO policy rows into §7/§10). The browser login gate rows (LG-1..LG-20) fold into the new §13.
