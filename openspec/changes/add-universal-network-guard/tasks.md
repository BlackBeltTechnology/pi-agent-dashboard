# Tasks

## 1. Guard as the last onRequest hook, namespace-scoped

- [ ] 1.1 Add a `networkGuardHook` (onRequest form) in `localhost-guard.ts` with jurisdiction over `/api/*`, `/v1/*`, `/editor/*`, `/live/*`; outside jurisdiction it returns immediately (no-op). Within jurisdiction, deny-by-default unless a pass condition (reuse `createNetworkGuard` logic) or an in-namespace exception holds.
- [ ] 1.2 In-namespace exceptions: `/api/health`, `PUBLIC_PAIRING_PREFIXES`, configured `auth.bypassUrls` (reuse `isBypassed`). Use anchored/exact matching for fixed endpoints.
- [ ] 1.3 Register the hook **last unconditionally** in `server.ts` — after hostGate (1429), cors (1430), mutationOriginGate (1456), CSP (1462), `registerBearerAuth` (1471), `registerAuthPlugin` (conditional, 1473), `createRouteTierGate` (1488), `proxyAuthGate` (conditional, 2005). Do NOT anchor "last" on a conditional hook — with modelProxy disabled 2005 does not exist.
- [ ] 1.6 Reuse `createNetworkGuard`'s denial path: `network_not_allowed` body (clients branch on it) AND the `blockEvents` recording (`localhost-guard.ts:184-191`) feeding `GET /api/tunnel/block-events`. The hook denies first and skips the per-route preHandler, so a divergent shape would regress guarded routes + the trust-network UI.
- [ ] 1.7 Read trusted networks via the live thunk `() => liveTrustedNetworks(config.resolvedTrustedNetworks ?? [])` (D15, mirrors `server.ts:1498`), never a boot snapshot.
- [ ] 1.4 Confirm `request.isAuthenticated` is decorated `false` unconditionally (server.ts:1467 — verified present).
- [ ] 1.5 Match on the parsed **pathname**, never `request.url`: jurisdiction prefixes anchored on a trailing slash (`/api/`, `/v1/`, `/editor/`, `/live/`); `/api/health` compared exactly and accepting GET **and HEAD**; `PUBLIC_PAIRING_PREFIXES` / `bypassUrls` as anchored prefixes. Do NOT copy `auth-plugin.ts:308`'s `request.url === "/api/health"` (misses `?query`). Unparseable URL → **fail closed** (treat as in-jurisdiction, deny).
- [ ] 1.8 Note in code + review: with auth ON the unchanged `auth-plugin` (raw-`request.url` matching, 306-315) runs first, so the pathname fix governs the auth-off path only. Unifying both matchers is out of scope — do not silently "fix" auth-plugin here.

## 2. /v1 proxy gate sets isAuthenticated

- [ ] 2.1 In `model-proxy/auth-gate.ts`, set `request.isAuthenticated = true` on successful `pi-proxy-*` key validation (before the success `return` at ~112, beside the `proxyApiKeyId` attach).
- [ ] 2.2 Confirm the guard admits `/v1/*` via `isAuthenticated`; there is NO public `/v1` bypass (so proxy-disabled `/v1` is not silently open).

## 3. Out-of-jurisdiction untouched + second port

- [ ] 3.1 Confirm static assets, SPA index (`/`), SPA deep-link fallback (all three `setNotFoundHandler` registrations — `server.ts:2105`, `2129`, `2134`), `/manifest.json`, `/auth/*`, favicon, PWA icons are unaffected (not in jurisdiction).
- [ ] 3.2 Model-proxy second port (`server.ts:2948-2972`, `listen` host hardcoded `127.0.0.1` at 2970): keep the `127.0.0.1` bind and add a test asserting it is loopback-only (safe-by-design, not by accident). If the bind is ever made configurable, install the universal guard on that instance too.
- [ ] 3.3 Anchor jurisdiction matching on `/api/`, `/v1/`, `/editor/`, `/live/` (trailing slash); `/editor/*` has no route in the standalone server — keep it in jurisdiction and assert no client-side SPA route lives under a guarded namespace (an unmatched in-jurisdiction path 403s instead of reaching the SPA handler).
- [ ] 3.4 `/mcp` stays **out of jurisdiction** (it self-authenticates via `host.verifyDeviceToken` and deliberately distrusts `request.isAuthenticated` — `server.ts:1185-1191`; putting it in jurisdiction would 403 every legitimate MCP client). Classify it as an enumerated independently-authenticated namespace and verify every `/mcp*` route — including bare `/mcp` (no trailing slash) — goes through the plugin's own auth (`mcp-server-plugin/src/server/routes.ts:194,331-333,352-353`).
- [ ] 3.5 Record the Fastify invariant the scheme rests on: a root hook registered last still binds to routes registered earlier (bound at `preReady`), including encapsulated plugin scopes — but NOT routes registered after `ready()`. Plugin activation is restart-effective today; a future hot-load feature would reopen VD2.

## 4. Coverage + observability

- [ ] 4.1 Add the namespace-coverage test **with plugin routes loaded** (otherwise it is a false green): assert every non-static/non-`/auth`/non-public route sits under a guarded namespace OR an explicitly enumerated independently-authenticated namespace (`/mcp`). Static-allow set MUST include `/sw.js` (`client/src/main.tsx:171` registers it — the first draft wrongly claimed no service worker exists).
- [ ] 4.2 Emit a structured denial log (path, source IP, reason); no body/token.
- [ ] 4.3 Document the behavior change: CHANGELOG entry + docs note that a tunnel + auth-off deployment loses plugin-route access (kb/flows/automation) unless auth is enabled or the caller's network is added to `trustedNetworks`. Reuse the existing `tunnel-block-events` denial buffer for in-product visibility if it already surfaces guard denials.

## Tests

_Folded from `test-plan.md`. L1 = vitest `fastify.inject`; L3 = Playwright vs docker harness (port from `.pi-test-harness.json`)._

- [ ] T1 (test-plan #S1) L1, see `packages/server/src/__tests__/localhost-guard.test.ts` — guard installed, `/api/sessions` has no per-route preHandler · untrusted public IP (`x-forwarded-for`), no cookie · 403 `network_not_allowed`.
- [ ] T2 (test-plan #S2) L1, see `localhost-guard.test.ts` — hooks in order bearer→oauth→proxy→guard(last) · request with valid bearer · guard reads `isAuthenticated=true`, allows.
- [ ] T3 (test-plan #S3) L1, see `models-introspection-routes.test.ts` — auth off · proxied request to `POST /api/plugins/automation/create` · 403, no file written, no spawn.
- [ ] T4 (test-plan #S4) L1, see `localhost-guard.test.ts` — auth off · untrusted unauth `PUT /api/provider-auth/api-key` · 403.
- [ ] T5 (test-plan #S5) L1, see `localhost-guard.test.ts` — auth off · genuine-local loopback (127.0.0.1, no forwarding headers) · allowed.
- [ ] T6 (test-plan #S6) L1, see `localhost-guard.test.ts` — auth off · unauth `GET /api/health` · allowed (in-namespace exception).
- [ ] T7 (test-plan #S7) L1, see `localhost-guard.test.ts` — unauth `POST /api/pair/redeem` (PUBLIC_PAIRING_PREFIXES) · allowed (not network-403).
- [ ] T8 (test-plan #S8) L1, see `auth.test.ts` — unauth untrusted `/api` ws-ticket mint endpoint · 403 (mint guarded, not public).
- [ ] T9 (test-plan #S9) L1, see `auth.test.ts` — auth off · unauth untrusted `GET /` · 200 SPA index (out of jurisdiction).
- [ ] T10 (test-plan #S10) L1, see `auth.test.ts` — unauth `GET /settings` via `setNotFoundHandler` fallback · 200 SPA index.
- [ ] T11 (test-plan #S11) L1, see `build-auth-status.test.ts` — unauth `GET /auth/status` · 200 (auth-enabled detectable).
- [ ] T12 (test-plan #S12) L1, see `model-proxy-auth-gate.test.ts` — valid `pi-proxy-*` key · `POST /v1/messages` · gate sets `isAuthenticated`, guard allows, proxied.
- [ ] T13 (test-plan #S13) L1, see `model-proxy-auth-gate.test.ts` — no/invalid credential, untrusted IP · `GET /v1/models` · rejected (401/403), not silently allowed.
- [ ] T14 (test-plan #S14) L1, see `model-proxy-auth-gate.test.ts` — modelProxy disabled · untrusted `/v1/anything` · not admitted by any public `/v1` bypass (403/404).
- [ ] T15 (test-plan #S15) L1, see `cors.test.ts` — allowed origin · `OPTIONS /api/sessions` preflight · CORS answers 204/200, guard does not 403 it.
- [ ] T16 (test-plan #S16) L1, see `model-proxy-auth-gate.test.ts` — modelProxy secondPort enabled · server start · second Fastify instance listens on 127.0.0.1 only.
- [ ] T17 (test-plan #S17) L1, new suite `network-guard-namespace-coverage.test.ts` (harness see `localhost-guard.test.ts`) — enumerate route table · every non-static/non-`/auth`/non-public route resolves under `/api`,`/v1`,`/editor`,`/live`, else fail.
- [ ] T18 (test-plan #S18) L1, see `localhost-guard.test.ts` — guard denies `203.0.113.5`→`/api/sessions` · log line has path+ip+reason, no body/token.
- [ ] T19 (test-plan #S20) L3, see `tests/e2e/csp.spec.ts` — docker harness, auth off, proxied frontend · `GET /` 200 app shell AND `POST /api/plugins/automation/create` 403 (flagship: shell loads, RCE route closed).
- [ ] T20 (new, spec: pathname matching) L1, see `localhost-guard.test.ts` — unauth untrusted `GET /api/health?probe=1` allowed AND `GET /api/healthz` 403 AND `GET /apiv2/x` out of jurisdiction.
- [ ] T22 (test-plan #S22) L1, see `localhost-guard.test.ts` — `auth.bypassUrls` configured for a route that carries a per-route `networkGuard` · untrusted unauth request · still 403 (documented trade-off: exception does not widen guarded routes; matches today's behavior).
- [ ] T23 (test-plan #S23) L1, see `localhost-guard.test.ts` — denied request · `network_not_allowed` body shape preserved AND entry appears in `GET /api/tunnel/block-events`.
- [ ] T24 (test-plan #S24) L1, new `network-guard-namespace-coverage.test.ts` — plugin routes loaded · `/mcp*` passes only via the enumerated independently-authenticated entry; every `/mcp*` route requires device-token auth; no client SPA route under a guarded namespace.
- [ ] T25 (test-plan #S25) L1, see `localhost-guard.test.ts` — `HEAD /api/health` allowed; unparseable URL denied (fail-closed); runtime-added trusted CIDR admits without restart.
- [ ] T21 (test-plan: manual-only) manual — real zrok tunnel, auth off · `GET /` 200, automation/create 403, valid `pi-proxy` `/v1/messages` 200 (human confirmation; deferred post-merge by ship-change).

## Discipline checkpoints

- [ ] D1 `doubt-driven-review` — COMPLETE, 2 cycles. Cycle 1: pivot to namespace-scoped, `/v1` proxy-gate + guard-last ordering, SPA/auth out of jurisdiction. Cycle 2 (single-model + cross-model on `@propose-review-2`; `@propose-review-1` probed empty): `/mcp` omission, `/sw.js` false claim, denial-shape + blockEvents preservation, full 8-hook inventory, live-thunk trusted networks, bypassUrls-vs-preHandler trade-off, HEAD/fail-closed matching, Fastify preReady binding invariant. All folded. Re-review if the jurisdiction set or the independently-authenticated set changes.
- [ ] D2 `security-hardening` — STRIDE the jurisdiction matcher (prefix anchoring, no `/api/health` over-match), the `/v1` gate wiring, and deny-by-default within jurisdiction.
- [ ] D3 `scenario-design` — matrix realized (see folded Tests): loopback · trusted · tunnel-authed · tunnel-anon · plugin · /v1 valid/invalid · /api/health · pairing · ws-mint · SPA shell · /auth/status · preflight.

## Validate

- [ ] V1 `openspec validate add-universal-network-guard --strict` passes.
- [ ] V2 `npm test` green (auth, localhost-guard, trusted-networks, ws-upgrade, cors, model-proxy suites).
- [ ] V3 Manual: with auth off over a tunnel — `GET /` and `GET /auth/status` return 200; `POST /api/plugins/automation/create` returns 403; a valid `pi-proxy-*` `/v1/messages` succeeds.
