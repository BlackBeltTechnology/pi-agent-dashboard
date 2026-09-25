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

**Scope note (D18/D19/D20).** LG-1..LG-20 characterize the **optional bundled dashboard-client
adapter** — the dashboard's own React client as the frontend, with core mounting a trusted
`login-provider` **component** (component-only; no `startLogin` function rides the manifest). They are
NOT the current deployment (design.md D20) and are not fresh evidence for it. The descriptor shape
under D19 is `{ pluginId }` plus exactly one usable kind — `{ issuer, clientId }` (component) or
`{ loginUrl, logoutUrl }` (separate view) — with trust sourced from the **current**
`identity.trustedResolverPlugins` allowlist (bundled id included); read the LG-1/LG-2 `browserClientId`
wording as "a usable registered descriptor kind" (the `browserClientId`/`browserIssuer` config fields
were dropped by D18). 

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

## Independent frontend (D20 — current deployment; disposable real-Keycloak smoke)

The browser frontend is the USER's own application; the dashboard is a backend resource server only
and serves no login UI. A custom independent **server** plugin owns login/callback/logout, serves its
own same-origin pages, and publishes only `{ pluginId, loginUrl, logoutUrl }` via
`registerBrowserLoginConfig`. The smoke (`spike/identity-login-plane/`) keeps the token in its own
page memory and NEVER navigates the dashboard React UI. **Status: one live run exists** — the spike's
LAN harness `lan-e2e.mjs` passed against real Keycloak on the LAN (`192.168.0.157 8010`; spike node
route tests 20/20 green), covering SM-1/SM-3/SM-4/SM-7 at HTTP/protocol level ONLY; SM-2/SM-5/SM-6
remain UNRUN, the browser-RENDERED clickthrough is UNRUN, and an empty owned list is NOT an ownership
result. The §13 LG-* checkmarks record the superseded component-adapter model and are not results for
this path. Level L3, opt-in real-Keycloak harness (disposable smoke).

| # | Class | Technique | Level | Disp. | INPUT → TRIGGER → OBSERVABLE |
|---|---|---|---|---|---|
| SM-1 | integration | scenario | L3 | automated | Real Keycloak (anna) + browser on the plugin-served same-origin page → sign in → authorize→code→token completes in the plugin's own pages, the token stays in the smoke page's OWN memory, the dashboard React UI is never mounted/navigated, and no token is handed to the dashboard client. |
| SM-2 | edge | decision-table | L3 | automated | Plugin registers `{pluginId, loginUrl, logoutUrl}` → unauth `GET /api/identity/login-config` → `{active:true, pluginId, loginUrl, logoutUrl}` relayed + sanitized same-origin; plugin disabled or not in the CURRENT `identity.trustedResolverPlugins` allowlist → `{active:false}` with no details. |
| SM-3 | edge | state | L3 | automated | In-memory token from the smoke page → `GET /api/sessions` WITH `Authorization: Bearer` → accepted, owner-scoped; the same call with NO bearer → refused (401/403), discloses nothing. |
| SM-4 | edge | state-transition | L3 | automated | Same bearer → mint a browser-scope ws-ticket, upgrade with `?ticket=` only, exchange a message → mint 200 + single-use ticket, owner-scoped upgrade accepted, bootstrap/message received; ticketless upgrade refused; wrong-`aud` bearer at mint refused (401). |
| SM-5 | integration | scenario | L3 | automated | Real KC anna + béla (distinct `(iss,sub)`) → each drives list/detail/WS bootstrap with its own bearer → each sees ONLY its own sessions; non-owner detail ⇒ 404 (no oracle); principal-less caller sees nothing. |
| SM-6 | frontend-quirk | state-transition | L3 | automated | Token past `exp`; socket at `principalExpiresAt` → API call refused (401); socket closed (code 4001), subscriptions released, no retained ownership. |
| SM-7 | edge | state | L3 | automated | D20 path with no core URL-fragment token adoption and no BFF/reverse proxy/global cookie → full sign-in → API → WS succeeds with the token never leaving the smoke page's memory; grep-guard: no core adoption of a `#access_token=` fragment (spike's informal label is not wired into core). |

**Live evidence + accurate scope (LAN smoke run, `node lan-e2e.mjs 192.168.0.157 8010`):**

- **SM-1 PARTIAL** — full server-side HTTP chain observed (`/identity-login/start` → KC authorize with
  PKCE S256 + `pi_login_bind` binding cookie → credential POST → `/identity-login/callback` →
  `/identity-login/app#access_token=…`); handoff stayed on the dashboard origin and targeted the PLUGIN
  app, never `/`; no `localhost` in the hop chain; node test asserts the app page holds the token in
  memory only. **UNRUN:** the browser-RENDERED clickthrough.
- **SM-2 UNRUN** — the run never called `GET /api/identity/login-config`; descriptor relay/sanitize and
  the current-allowlist trust filter are unexercised (the spike only CALLS
  `registerBrowserLoginConfig`).
- **SM-3 PARTIAL** — bearer `GET /api/sessions` ⇒ 200 (0 sessions: acceptance only); no-bearer ⇒ 403,
  which is the non-loopback network guard, not an identity verdict. **0 sessions proves NO ownership
  scoping.** (A no-bearer-200 Audit finding was disproved by this live 403 — do not carry it.)
- **SM-4 PARTIAL** — ws-ticket mint 200; authenticated `?ticket=` upgrade ⇒ `sessions_snapshot` +
  `sessions_page_result`; ticketless upgrade refused (403). **UNRUN:** wrong-`aud` mint 401, ticket
  single-use, owner-scoped content.
- **SM-5 UNRUN** — no second user through the D20 path. Also BLOCKED by the verified gap below.
- **SM-6 UNRUN** — neither stale-token 401 nor socket expiry (close 4001).
- **SM-7 PARTIAL** — the live flow handed the bearer only to `/identity-login/app`, so no dashboard-root
  handoff; but the grep-guard FAILS as written — core ships `consumeTokenHandoff`
  (`packages/client/src/main.tsx` + `lib/identity/handoff.ts`).

**Verified security gap blocking SM-5:** `session-meta-handler.handleSessionsPage` / `handleListSessions`
return sessions with no owner filter (`sessionManager.get(id)` / `listAll()`), and the §8.3 choke point
gates `session` scope only, never `session-list` (per `identity/ws-message-scope.ts`). Needs a per-item
filter + regression test before any isolation claim.


## Self-lockout guard (D21 — enforcement arms only when fully configured; decided once, latched)

| # | Class | Technique | Level | Disp. | INPUT → TRIGGER → OBSERVABLE |
|---|---|---|---|---|---|
| LK-1 | edge | decision-table | L1 | automated | `{resolverActive, loginProviderRegistered, authProviderCount, trustedPolicyPlugin, registeredPolicyCount}` matrix → `isIdentityEnforced` → true ONLY for resolver + login provider + 0 connectors + (no policy named OR exactly 1 registered); every other row false. |
| LK-2 | error | decision-table | L1 | automated | Each partial/conflicting combination → `identityDisarmedWarning` → names every reason (no login provider / no resolver / `auth.providers` D8 / policy-count D9); null when inert-by-choice or armed. |
| LK-3 | error | fault-injection | L1 | automated | Trusted plugin registers resolver + descriptor + policy, then activation throws → post-load release → all three registrations disposed, logged; a loaded plugin's registrations untouched; second release is a no-op. |
| LK-4 | error | fault-injection | L1 | automated | Server boot with a trusted drop-in that registers a descriptor then throws, `keycloak-resolver` active → `createTestServer` boot → server listens, log shows release + "NOT enforced", `GET /api/identity/login-config` = `{active:false}`, ticketless genuinely-local browser `/ws` upgrade admitted. |
| LK-5 | error | state-transition | L1 | automated | Boot with `identity.trustedPolicyPlugin` named-but-absent (and separately: duplicate) → `createTestServer` boot → boot succeeds, log names the D9 mismatch, plane inert. Same for resolver active + `auth.providers` connectors that RESOLVE and mount (D8). |
| LK-13 | edge | EP | L1 | automated | Resolver + login provider + `auth.providers` entry that resolves to NO provider (e.g. no `issuerUrl`) → boot → legacy cookie auth not mounted, identity ENFORCED (no D8 disarm), no-token `/auth/status` `{authenticated:false,authEnabled:true}`. |
| LK-6 | edge | EP | L1 | automated | Enforced; caller with no bearer principal (loopback, device bearer, nothing) → `GET /auth/status` → `{authenticated:false, authEnabled:true}`; with a resolved principal → `{authenticated:true, authEnabled:true}`; not enforced → `{authenticated:true, authEnabled:false}`. |
| LK-7 | edge | decision-table | L1 | automated | `auth` block present but no provider resolves (legacy plugin registers no route) + enforced → `GET /auth/status` → the identity-aware route answers (not 404, not the cookie route); `auth` block WITH resolved providers → the legacy cookie route answers and identity is inert (D8). |
| LK-8 | edge | state-transition | L1 | automated | Armed server; after `listen()` the login plugin calls its descriptor unregister handle (and separately its resolver / policy handle), and another trusted plugin attempts a late registration → subsequent request/upgrade → handles are logged no-ops, late registration refused + logged; enforcement unchanged (identity ticket still required, owner gating on); `login-config` still advertises the latched descriptor; no mixed state. |
| LK-9 | edge | state | L1 | automated | Login descriptor registered, NO resolver active → boot → inert, `login-config` `{active:false}`, warning names the missing resolver. |
| LK-10 | edge | state | L3 | automated | Identity E2E harness (`PI_E2E_IDENTITY=1`) must seed a trusted login descriptor in addition to `keycloak-resolver`, else it silently runs inert → `npm run test:e2e:identity` → the existing §11.2 isolation spec is green AGAINST AN ENFORCED plane (assert `login-config` `active:true` in global-setup). |
| LK-11 | error | state | L3 | automated | Harness variant: `keycloak-resolver` seeded, NO login descriptor → rendered dashboard at the harness URL (genuinely local to the container) → the dashboard connects (no "Server offline"); a ticketless browser `/ws` upgrade is admitted. |
| LK-12 | — | — | — | manual-only | Operator reads `server.log` on a half-configured install → the single `[identity] identity is NOT enforced — …` line is understandable and names what to fix; armed-without-token browser shows an auth-required state, not "Server offline". |

**Verified pre-existing gap (not a D21 scenario; blocks any multi-user isolation claim):** §9.2 gates the `browser` WS scope only. `/ws/terminal/<id>` (`terminal/terminal-gateway.ts` `handleUpgrade` → `manager.attach`) performs no principal check and keeps the legacy loopback / local-token / trusted-network / principal-less-ticket allowances; every browser socket receives `terminal_added` for ALL terminals on connect (`pairing/browser-gateway.ts`, "Send active terminals on connect"). `live` scope likewise ungated. Tracked in tasks §18.

---

**Fold target:** SM-* rows fold into tasks §17. They are the D20 (**current deployment**)
verification; the §13/LG-* rows fold into the optional bundled adapter only.

**Fold target:** these rows fold into tasks §4–§12 (unit/L1 into their feature groups; L3 into §11.2; BC-* into §12; AP-5 session-road meta-test into §8; AP/FO policy rows into §7/§10). The browser login gate rows (LG-1..LG-20) fold into the new §13.

**Fold target:** LK-* rows fold into tasks §18 (D21). Doubt-review ran 3 cycles (single-model; the `@propose-review-1` cross-model role probed empty).
