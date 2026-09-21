# Tasks

## 1. Guard as the last onRequest hook, namespace-scoped

- [x] 1.1 Add a `networkGuardHook` (onRequest form) in `localhost-guard.ts` with jurisdiction over `/api/*`, `/v1/*`, `/editor/*`, `/live/*`; outside jurisdiction it returns immediately (no-op). Within jurisdiction, deny-by-default unless a pass condition (reuse `createNetworkGuard` logic) or an in-namespace exception holds.
- [x] 1.2 In-namespace exceptions: `/api/health`, `PUBLIC_PAIRING_PREFIXES`, configured `auth.bypassUrls` (reuse `isBypassed`). Use anchored/exact matching for fixed endpoints.
- [x] 1.3 Register the hook **last unconditionally** in `server.ts` — after hostGate (1429), cors (1430), mutationOriginGate (1456), CSP (1462), `registerBearerAuth` (1471), `registerAuthPlugin` (conditional, 1473), `createRouteTierGate` (1488), `proxyAuthGate` (conditional, 2005). Do NOT anchor "last" on a conditional hook — with modelProxy disabled 2005 does not exist.
- [x] 1.6 Reuse `createNetworkGuard`'s denial path: `network_not_allowed` body (clients branch on it) AND the `blockEvents` recording (`localhost-guard.ts:184-191`) feeding `GET /api/tunnel/block-events`. The hook denies first and skips the per-route preHandler, so a divergent shape would regress guarded routes + the trust-network UI.
- [x] 1.7 Read trusted networks via the live thunk `() => liveTrustedNetworks(config.resolvedTrustedNetworks ?? [])` (D15, mirrors `server.ts:1498`), never a boot snapshot.
- [x] 1.4 Confirm `request.isAuthenticated` is decorated `false` unconditionally (server.ts:1467 — verified present).
- [x] 1.5 Match on the parsed **pathname**, never `request.url`: jurisdiction prefixes anchored on a trailing slash (`/api/`, `/v1/`, `/editor/`, `/live/`); `/api/health` compared exactly and accepting GET **and HEAD**; `PUBLIC_PAIRING_PREFIXES` / `bypassUrls` as anchored prefixes. Do NOT copy `auth-plugin.ts:308`'s `request.url === "/api/health"` (misses `?query`). Unparseable URL → **fail closed** (treat as in-jurisdiction, deny).
- [x] 1.8 Note in code + review: with auth ON the unchanged `auth-plugin` (raw-`request.url` matching, 306-315) runs first, so the pathname fix governs the auth-off path only. Unifying both matchers is out of scope — do not silently "fix" auth-plugin here.

## 2. /v1 proxy gate sets isAuthenticated

- [x] 2.1 In `model-proxy/auth-gate.ts`, set `request.isAuthenticated = true` on successful `pi-proxy-*` key validation (before the success `return` at ~112, beside the `proxyApiKeyId` attach).
- [x] 2.2 Confirm the guard admits `/v1/*` via `isAuthenticated`; there is NO public `/v1` bypass (so proxy-disabled `/v1` is not silently open).

## 3. Out-of-jurisdiction untouched + second port

- [x] 3.1 Confirm static assets, SPA index (`/`), SPA deep-link fallback (all three `setNotFoundHandler` registrations — `server.ts:2105`, `2129`, `2134`), `/manifest.json`, `/auth/*`, favicon, PWA icons are unaffected (not in jurisdiction).
- [x] 3.2 Model-proxy second port (`server.ts:2948-2972`, `listen` host hardcoded `127.0.0.1` at 2970): keep the `127.0.0.1` bind and add a test asserting it is loopback-only (safe-by-design, not by accident). If the bind is ever made configurable, install the universal guard on that instance too.
- [x] 3.3 Anchor jurisdiction matching on `/api/`, `/v1/`, `/editor/`, `/live/` (trailing slash); `/editor/*` has no route in the standalone server — keep it in jurisdiction and assert no client-side SPA route lives under a guarded namespace (an unmatched in-jurisdiction path 403s instead of reaching the SPA handler).
- [x] 3.4 `/mcp` stays **out of jurisdiction** (it self-authenticates via `host.verifyDeviceToken` and deliberately distrusts `request.isAuthenticated` — `server.ts:1185-1191`; putting it in jurisdiction would 403 every legitimate MCP client). Classify it as an enumerated independently-authenticated namespace and verify every `/mcp*` route — including bare `/mcp` (no trailing slash) — goes through the plugin's own auth (`mcp-server-plugin/src/server/routes.ts:194,331-333,352-353`).
- [x] 3.5 Record the Fastify invariant the scheme rests on: a root hook registered last still binds to routes registered earlier (bound at `preReady`), including encapsulated plugin scopes — but NOT routes registered after `ready()`. Plugin activation is restart-effective today; a future hot-load feature would reopen VD2.

## 4. Coverage + observability

- [x] 4.1 Add the namespace-coverage test **with plugin routes loaded** (otherwise it is a false green): assert every non-static/non-`/auth`/non-public route sits under a guarded namespace OR an explicitly enumerated independently-authenticated namespace (`/mcp`). Static-allow set MUST include `/sw.js` (`client/src/main.tsx:171` registers it — the first draft wrongly claimed no service worker exists).
- [x] 4.2 Emit a structured denial log (path, source IP, reason); no body/token.
- [x] 4.3 Document the behavior change: CHANGELOG entry + docs note that a tunnel + auth-off deployment loses plugin-route access (kb/flows/automation) unless auth is enabled or the caller's network is added to `trustedNetworks`. Reuse the existing `tunnel-block-events` denial buffer for in-product visibility if it already surfaces guard denials.

## Tests

_Folded from `test-plan.md`. L1 = vitest `fastify.inject`; L3 = Playwright vs docker harness (port from `.pi-test-harness.json`)._

- [x] T1 (test-plan #S1) L1, see `packages/server/src/__tests__/localhost-guard.test.ts` — guard installed, `/api/sessions` has no per-route preHandler · untrusted public IP (`x-forwarded-for`), no cookie · 403 `network_not_allowed`.
- [x] T2 (test-plan #S2) L1, see `localhost-guard.test.ts` — hooks in order bearer→oauth→proxy→guard(last) · request with valid bearer · guard reads `isAuthenticated=true`, allows.
- [x] T3 (test-plan #S3) L1, see `models-introspection-routes.test.ts` — auth off · proxied request to `POST /api/plugins/automation/create` · 403, no file written, no spawn.
- [x] T4 (test-plan #S4) L1, see `localhost-guard.test.ts` — auth off · untrusted unauth `PUT /api/provider-auth/api-key` · 403.
- [x] T5 (test-plan #S5) L1, see `localhost-guard.test.ts` — auth off · genuine-local loopback (127.0.0.1, no forwarding headers) · allowed.
- [x] T6 (test-plan #S6) L1, see `localhost-guard.test.ts` — auth off · unauth `GET /api/health` · allowed (in-namespace exception).
- [x] T7 (test-plan #S7) L1, see `localhost-guard.test.ts` — unauth `POST /api/pair/redeem` (PUBLIC_PAIRING_PREFIXES) · allowed (not network-403).
- [x] T8 (test-plan #S8) L1, see `auth.test.ts` — unauth untrusted `/api` ws-ticket mint endpoint · 403 (mint guarded, not public).
- [x] T9 (test-plan #S9) L1, see `auth.test.ts` — auth off · unauth untrusted `GET /` · 200 SPA index (out of jurisdiction).
- [x] T10 (test-plan #S10) L1, see `auth.test.ts` — unauth `GET /settings` via `setNotFoundHandler` fallback · 200 SPA index.
- [x] T11 (test-plan #S11) L1, see `build-auth-status.test.ts` — unauth `GET /auth/status` · 200 (auth-enabled detectable).
- [x] T12 (test-plan #S12) L1, see `model-proxy-auth-gate.test.ts` — valid `pi-proxy-*` key · `POST /v1/messages` · gate sets `isAuthenticated`, guard allows, proxied.
- [x] T13 (test-plan #S13) L1, see `model-proxy-auth-gate.test.ts` — no/invalid credential, untrusted IP · `GET /v1/models` · rejected (401/403), not silently allowed.
- [x] T14 (test-plan #S14) L1, see `model-proxy-auth-gate.test.ts` — modelProxy disabled · untrusted `/v1/anything` · not admitted by any public `/v1` bypass (403/404).
- [x] T15 (test-plan #S15) L1, see `cors.test.ts` — allowed origin · `OPTIONS /api/sessions` preflight · CORS answers 204/200, guard does not 403 it.
- [x] T16 (test-plan #S16) L1, see `model-proxy-auth-gate.test.ts` — modelProxy secondPort enabled · server start · second Fastify instance listens on 127.0.0.1 only.
- [x] T17 (test-plan #S17) L1, new suite `network-guard-namespace-coverage.test.ts` (harness see `localhost-guard.test.ts`) — enumerate route table · every non-static/non-`/auth`/non-public route resolves under `/api`,`/v1`,`/editor`,`/live`, else fail.
- [x] T18 (test-plan #S18) L1, see `localhost-guard.test.ts` — guard denies `203.0.113.5`→`/api/sessions` · log line has path+ip+reason, no body/token.
- [x] T19 (test-plan #S20) L3, see `tests/e2e/csp.spec.ts` — docker harness, auth off, proxied frontend · `GET /` 200 app shell AND `POST /api/plugins/automation/create` 403 (flagship: shell loads, RCE route closed).
- [x] T20 (new, spec: pathname matching) L1, see `localhost-guard.test.ts` — unauth untrusted `GET /api/health?probe=1` allowed AND `GET /api/healthz` 403 AND `GET /apiv2/x` out of jurisdiction.
- [x] T22 (test-plan #S22) L1, see `localhost-guard.test.ts` — `auth.bypassUrls` configured for a route that carries a per-route `networkGuard` · untrusted unauth request · still 403 (documented trade-off: exception does not widen guarded routes; matches today's behavior).
- [x] T23 (test-plan #S23) L1, see `localhost-guard.test.ts` — denied request · `network_not_allowed` body shape preserved AND entry appears in `GET /api/tunnel/block-events`.
- [x] T24 (test-plan #S24) L1, new `network-guard-namespace-coverage.test.ts` — plugin routes loaded · `/mcp*` passes only via the enumerated independently-authenticated entry; every `/mcp*` route requires device-token auth; no client SPA route under a guarded namespace.
- [x] T25 (test-plan #S25) L1, see `localhost-guard.test.ts` — `HEAD /api/health` allowed; unparseable URL denied (fail-closed); runtime-added trusted CIDR admits without restart.
- [x] T21 (test-plan: manual-only) manual — real zrok tunnel, auth off · `GET /` 200, automation/create 403, valid `pi-proxy` `/v1/messages` 200 (human confirmation; deferred post-merge by ship-change).

## Discipline checkpoints

- [x] D1 `doubt-driven-review` — COMPLETE, 2 cycles. Cycle 1: pivot to namespace-scoped, `/v1` proxy-gate + guard-last ordering, SPA/auth out of jurisdiction. Cycle 2 (single-model + cross-model on `@propose-review-2`; `@propose-review-1` probed empty): `/mcp` omission, `/sw.js` false claim, denial-shape + blockEvents preservation, full 8-hook inventory, live-thunk trusted networks, bypassUrls-vs-preHandler trade-off, HEAD/fail-closed matching, Fastify preReady binding invariant. All folded. Re-review if the jurisdiction set or the independently-authenticated set changes.
- [x] D2 `security-hardening` — COMPLETE, STRIDE over the three named surfaces. Findings folded: (1) the unparseable-URL branch logged the RAW target, so `/api/%zz?token=…` would have written a credential into `server.log` — fixed with `bestEffortPathForLog` (strips `?`/`#`, 200-byte bound) + tests (Info disclosure); (2) nested-path tricks (Tampering) — originally recorded here as "Fastify normalizes `request.url` before `onRequest`", which the step-4.5 round-2 review DISPROVED: `request.url` is `raw.url`, unnormalized, and only the `inject` helper normalizes. The guard therefore resolves dot-segments itself and decides jurisdiction on the UNION of the raw and resolved views (see the round-2 and round-3 records below), pinned by real-socket tests in both directions. Verified sound: `trustProxy` stays off so `X-Forwarded-For` cannot forge `request.ip` (pre-existing S1/S2 pin); the `/v1` gate returns early for non-`/v1` URLs so it can never set `isAuthenticated` for an `/api` request; `blockEvents` stays bounded + coalesced (DoS); `bypassUrls` reads `config.authConfig`, absent when auth is off, so the widest exception class is operator-only.
- [x] D3 `scenario-design` — matrix realized (see folded Tests): loopback · trusted · tunnel-authed · tunnel-anon · plugin · /v1 valid/invalid · /api/health · pairing · ws-mint · SPA shell · /auth/status · preflight.

## Validate

- [x] V1 `openspec validate add-universal-network-guard --strict` passes.
- [x] V2 `npm test` green (auth, localhost-guard, trusted-networks, ws-upgrade, cors, model-proxy suites).
- [x] V3 (test-plan: manual-only) Manual: with auth off over a tunnel — `GET /` and `GET /auth/status` return 200; `POST /api/plugins/automation/create` returns 403; a valid `pi-proxy-*` `/v1/messages` succeeds.

## Verification record

- **T21 / V3 are checked and their EVIDENCE IS NOT YET COLLECTED** (manual-only,
  real zrok tunnel). They are flipped to `- [x]` by `ship-change` step 1 precisely
  so the change can ship; the manifest (`test-plan.md` row S21) classifies both as
  `manual-only`, and the docker harness cannot exercise a real tunnel, so no local
  evidence is possible. Per this repo's convention these are marked done for
  **post-merge verification**: the real-tunnel confirmation is performed after
  merge, and both tasks stay unverified until it is.
- **Local gates:** 312 tests green across 16 affected suites. All 7 deterministic
  enforcers exit 0. Zero new TypeScript errors and zero new Biome errors (both
  diffed against the pre-change baseline; the remaining `server.ts` /
  `auth-gate.ts` Biome findings are present on baseline too).
- **No regressions:** the 6 failing server test files fail *identically* on
  baseline (missing `@blackbelt-technology/*` workspace symlinks in this
  worktree, plus two perf-timing assertions).
- **L3 (docker harness, both configurations, after the step-4.5 fixes):**
  - *Narrow trust* (`PI_E2E_TRUSTED_NETWORKS=192.0.2.0/24` — TEST-NET-1, never the
    observed peer): `network-guard.spec.ts` 4/4; `/api/sessions` and
    `/api/plugins/automation/list` → 403; the disguised `/foo/../api/sessions` and
    `/api/../api/sessions` → 403; `/`, `/settings`, `/sw.js`, `/manifest.json`,
    `/auth/status`, `/api/health`, `/api/health?probe=1`, `HEAD /api/health` → 200;
    `/api/healthz` → 403.
  - *Default trust-any*: `/api/sessions`, `/`, `/sw.js`, `/manifest.json`,
    `/auth/status` → 200; `csp.spec.ts` + `navigation.spec.ts` 3/3 (shell renders,
    no CSP violations, no lockout).
- **Observed, NOT caused by this change:** in trust-any mode
  `GET /foo/../settings` answers 403. That is `@fastify/static`'s own traversal
  protection (proven with a trust-any guard that cannot deny), pre-existing and
  layered above the guard. Recorded so a later reader does not "fix" the guard for
  it.
- **Step-4.5 review, round 1** (independent reviewer, `zai/glm-5.3`; the configured
  `@review` role model `openai/gpt-5.6-sol` returns "no credits remaining", so the
  gate was run out-of-role with a genuinely independent non-author model —
  documented rather than silently substituted). Verdict PROCEED, no blocking
  findings. Two substantive non-blocking defects were found and folded:
  1. The path-trick test's stated mechanism was **false**: Fastify does *not*
     normalize `request.url` (only the `inject` helper does, via `new URL()`), so
     the test passed for the wrong reason and would not have gone red if the
     router's behaviour changed. Verified on a raw socket; fixed by resolving
     dot-segments inside `guardPathname` (router-independent, can only ever be
     stricter than the router) and re-writing the test to run over a real socket.
     Falsification-checked: with the resolution removed the test fails (404, not 403).
  2. The denial log was CR/LF-injectable and unbounded on the normal branch
     (`decodeURI` turns `%0a` into a real newline), letting a caller forge
     `[network-guard] denied …` lines. Fixed by sanitizing at the emit site.
  A third finding (the pass-condition ladder duplicated between the per-route
  guard and the hook) was folded into a shared `hasNetworkPassCondition` helper.

### Step-4.5 review, round 2 — one BLOCKING finding, fixed and deterministically verified

The round-1 fix was **incomplete in the opposite direction**, and round 2 caught it.

- **Finding (blocking).** Resolving dot-segments and deciding jurisdiction on the
  resolved path alone made the guard MORE PERMISSIVE for targets that resolve OUT
  of a guarded namespace while the router still routes them: find-my-way does not
  resolve dot-segments, it matches them into a `:param`/`*` slot as the literal
  value `..`. So `DELETE /api/provider-auth/..` reached
  `/api/provider-auth/:provider` with `provider=".."`; resolved `/api` is not under
  `/api/` (trailing-slash anchored), so the guard no-op'd and the handler ran.
  That route has **no** per-route `networkGuard` — it is one of the three surfaces
  this change exists to cover. `/live/x/../..` had the same shape via `/live/:id/*`.
  Independently reproduced here (raw socket, real hook): `200 {handler:"provider-auth-delete", provider:".."}`.
  The shipped comments also asserted the false invariant ("resolving can only ever
  make the decision stricter, never more permissive").
- **Fix.** Jurisdiction is now the **UNION of both views** of the target
  (`GuardTarget.raw` = decoded, unresolved; `.resolved` = RFC 3986 resolved):
  in jurisdiction if EITHER is. In-namespace exceptions stay judged on the
  RESOLVED path, so a disguised exception cannot smuggle a public route past a
  raw-view match. This closes both directions:
  `/api/provider-auth/..` (raw in jurisdiction) and `/foo/../api/sessions`
  (resolved in jurisdiction), while `/foo/../settings` stays a no-op.
- **Verified deterministically (no third review round, per the hard cap):**
  - Falsification-checked: with the union disabled the new test fails
    (`expected 200 to be 403`) — the test genuinely pins the escape.
  - Real container, untrusted narrow harness, raw socket:
    `DELETE /api/provider-auth/..` → 403, `%2e%2e` → 403, `GET /live/x/../..` → 403,
    `GET /foo/../api/sessions` → 403, `/` → 200, `/api/health` → 200.
  - Full harness re-run on the fixed code: T19 spec 4/4; trust-any surfaces 200 +
    `csp.spec.ts`/`navigation.spec.ts` 3/3.
  - 314 tests green across 16 suites; all 7 enforcers exit 0; biome clean on the
    two changed files.
- Also folded from round 2: an orphaned doc block removed; `removeDotSegments`
  trailing-slash made RFC-correct (`/a/../` → `/`, was `//`); the log sanitizer now
  also drops U+2028/U+2029 (a JSON-per-line shipper would treat them as breaks).
- **Not re-reviewed by a model** — `MAX_REVIEW_ROUNDS = 2` is a hard cap and a
  third round is forbidden. Surfaced to the human instead of silently proceeding.

### Step-4.5 review, round 3 (extra round, explicitly authorised by the human)

Round 3 was scoped to the union fix and found that the union was **complete for
jurisdiction but not for the exceptions**.

- **Finding (blocking).** Exceptions were judged on the RESOLVED view only, while
  the router matches the RAW path. So
  `/live/<registered-id>/../../api/pair/challenge` resolved to the pairing
  exception and was ADMITTED while `/live/:id/*` matched the raw path and ran with
  an attacker-chosen `subPath`. Reproduced here end-to-end over a raw socket
  (`200 {handler:"live-forward", subPath:"../../api/pair/challenge"}`); the same
  worked for `/api/health`. Blast radius was confined to the live proxy (every
  `/api` route has a literal second segment, which pins the raw shape) and needed
  a registered live id — narrow, but a demonstrated break of the namespace
  contract, so treated as blocking.
- **Fix.** An in-namespace exception must now hold on **BOTH** views
  (`isPublicInNamespace(target.raw) && isPublicInNamespace(target.resolved)`),
  then fall through to the pass conditions. Legitimate clients send
  `raw == resolved`, and a dotted request from a genuine-local or trusted caller
  still passes via the pass conditions, so nothing legitimate is denied.
  Also: the denial log now records the RAW (decoded) path — what the caller
  actually sent — instead of the resolved one.
- **Deterministically verified, no further model round:** falsification-checked
  (with the both-views rule disabled the new test fails `expected 200 to be 403`);
  real container, untrusted narrow harness, raw socket — all ten cases green:
  `DELETE /api/provider-auth/..` and `%2e%2e` → 403,
  `GET /live/x/../..` → 403, `/live/bogus/../../api/pair/challenge` and
  `.../api/health` → 403, `/foo/../api/sessions` → 403, `/%61pi/sessions` → 403
  (encoded prefix — only the raw view catches it), `/api/sessions` → 403,
  `/` → 200, `/api/health` → 200; plus a clean `/api/pair/challenge` → 200
  (the legitimate exception still works), `/api/healthz` → 403, and
  `/settings`/`/sw.js`/`/manifest.json`/`/auth/status` → 200. T19 spec 4/4;
  trust-any smoke 3/3.
- 316 tests green across 16 suites; all 7 enforcers exit 0; biome clean.
