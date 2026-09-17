# Test Plan — add-multi-user-identity-plane

Adversarial, real-life scenarios derived from the six specs. Stage: `apply` (soft gate). Each row is a Triple (INPUT / TRIGGER / OBSERVABLE) with a level and disposition. `[NEEDS CLARIFICATION]` markers, if any, are surfaced in the banner.

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
| PR-9 | edge | state | L1 | automated | Legacy mode + a resolver registered → dispatch does NOT invoke it; `principal` null, `isAuthenticated` exactly the legacy chain's value. |
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
| KC-12 | error | decision-table | L2 | automated | `identity.mode=multi-user` + non-empty `auth.providers` → startup fails before listen. |

## WebSocket principal binding + lifetime

| # | Class | Technique | Level | Disp. | INPUT → TRIGGER → OBSERVABLE |
|---|---|---|---|---|---|
| WS-1 | edge | state | L1 | automated | Principal-bearing request mints ticket → ticket records `(iss,sub)`+`expiresAt`, single-use, short-TTL. |
| WS-2 | edge | state-transition | L3 | automated | Multi-user mode, browser upgrade with cookie only, no ticket → upgrade refused. |
| WS-3 | edge | state-transition | L3 | automated | Multi-user mode, browser on trusted network, no ticket → upgrade refused (bypass does not apply). |
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
| AP-1 | error | decision-table | L2 | automated | Multi-user mode, zero policies → startup fails; two policies → startup fails; exactly one → boots. |
| AP-2 | error | fault-injection | L1 | automated | Policy times out (>configured) / throws / returns non-boolean → deny + structured audit event each. |
| AP-3 | edge | boundary | L1 | automated | Protected `/api` route with no classification in multi-user mode → denied (catch-all), not allowed. |
| AP-4 | edge | boundary | L1 | automated | Plugin registers a raw Fastify route bypassing the guarded helper → unclassified → denied at runtime in multi-user mode. |
| AP-5 | edge | coverage | L1 | automated | Add a protected route/message without classification → classification-coverage test fails (meta-test). |
| AP-6 | edge | state | L1 | automated | Unknown inbound WS message type in multi-user mode → refused. |
| AP-7 | edge | state | L3 | automated | Principal connects → bootstrap includes only owned sessions and only policy-permitted workspace/terminal/system state (no other user's paths/branches/terminals). |
| AP-8 | edge | state | L1 | automated | Only the `trustedPolicyPlugin`-named plugin can register `authorize`; another registrant refused. |

## Permissioned fan-out

| # | Class | Technique | Level | Disp. | INPUT → TRIGGER → OBSERVABLE |
|---|---|---|---|---|---|
| FO-1 | edge | decision-table | L1/L3 | automated | Anna + Béla sockets, domain event for Anna's resource, multi-user → only Anna receives; Béla does not; principal-less socket does not. |
| FO-2 | error | fault-injection | L1 | automated | Policy throws/times out for a candidate socket → event not delivered to it, denial logged. |
| FO-3 | edge | state | L1 | automated | Legacy mode → global broadcast unchanged (byte-for-byte prior behavior). |
| FO-4 | edge | state | L1 | automated | Session-scoped flow frame → delivered via owner-gated subscription road, NOT the policy road. |
| FO-5 | edge | boundary | L1 | automated | Undeclared frame type at emit → treated as protected domain event (policy-gated), never globally broadcast. |

## End-to-end (real Keycloak, two users)

| # | Class | Technique | Level | Disp. | INPUT → TRIGGER → OBSERVABLE |
|---|---|---|---|---|---|
| E2E-1 | integration | scenario | L3 | automated | Seeded realm (Anna, Béla), Authorization Code + PKCE login → each obtains a token, dashboard validates it, `(iss,sub)` distinct. |
| E2E-2 | integration | scenario | L3 | automated | Anna + Béla concurrent HTTP+WS → Béla reaches none of Anna's sessions across bootstrap, list, detail, subscribe, replay, command, and domain-event fan-out. |
| E2E-3 | edge | state | L3 | automated | Legacy default (no `identity` config) → current dashboard behavior identical (regression guard). |
| E2E-4 | perf | soak | L2 | manual-only | JWKS hot-path under sustained multi-user load — measure resolver p95; threshold TBD by deployment. Disposition manual until a perf harness exists. |

---

**New infra needed:** the L3 rows assume the docker E2E harness runs a seeded Keycloak container (realm with Anna/Béla, roles as identity-only). SITUATION.md notes the realm JSON exists but no container runs and the realm needs reseeding to drop group-based routing. That harness addition is a prerequisite for E2E-1/E2E-2 and is called out in tasks §11.2.

**Fold target:** these rows fold into tasks §4–§11 (unit/L1 into their feature groups; L3 into §11.2; AP-5 meta-test into §7.3–§7.4).
