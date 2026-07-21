# Tasks

## 1. Guard as the last onRequest hook, namespace-scoped

- [ ] 1.1 Add a `networkGuardHook` (onRequest form) in `localhost-guard.ts` with jurisdiction over `/api/*`, `/v1/*`, `/editor/*`, `/live/*`; outside jurisdiction it returns immediately (no-op). Within jurisdiction, deny-by-default unless a pass condition (reuse `createNetworkGuard` logic) or an in-namespace exception holds.
- [ ] 1.2 In-namespace exceptions: `/api/health`, `PUBLIC_PAIRING_PREFIXES`, configured `auth.bypassUrls` (reuse `isBypassed`). Use anchored/exact matching for fixed endpoints.
- [ ] 1.3 Register the hook **last** in `server.ts` — after `registerBearerAuth`, `registerAuthPlugin` (conditional), and the model-proxy `proxyAuthGate` (conditional, ~1418) — so `isAuthenticated` reflects all auth sources.
- [ ] 1.4 Confirm `request.isAuthenticated` is decorated `false` unconditionally (server.ts:983 — verified present).

## 2. /v1 proxy gate sets isAuthenticated

- [ ] 2.1 In `model-proxy/auth-gate.ts`, set `request.isAuthenticated = true` on successful `pi-proxy-*` key validation (before the success `return` at ~110-112).
- [ ] 2.2 Confirm the guard admits `/v1/*` via `isAuthenticated`; there is NO public `/v1` bypass (so proxy-disabled `/v1` is not silently open).

## 3. Out-of-jurisdiction untouched + second port

- [ ] 3.1 Confirm static assets, SPA index (`/`), SPA deep-link fallback (`setNotFoundHandler`), `/manifest.json`, `/auth/*`, favicon, PWA icons are unaffected (not in jurisdiction).
- [ ] 3.2 Model-proxy second port (`server.ts:~1875-1895`): keep the `127.0.0.1` bind and add a test asserting it is loopback-only (safe-by-design, not by accident). If the bind is ever made configurable, install the universal guard on that instance too.
- [ ] 3.3 Anchor jurisdiction matching on `/api/`, `/v1/`, `/editor/`, `/live/` (trailing slash); `/editor/*` is a harmless no-op in the standalone server.

## 4. Coverage + observability

- [ ] 4.1 Add the namespace-coverage test: enumerate the route table, assert every non-static/non-`/auth`/non-public route sits under a guarded namespace.
- [ ] 4.2 Emit a structured denial log (path, source IP, reason); no body/token.

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
- [ ] T20 (test-plan #S20) L3, see `tests/e2e/csp.spec.ts` — docker harness, auth off, proxied frontend · `GET /` 200 app shell AND `POST /api/plugins/automation/create` 403 (flagship: shell loads, RCE route closed).
- [ ] T19 (test-plan: manual-only) manual — real zrok tunnel, auth off · `GET /` 200, automation/create 403, valid `pi-proxy` `/v1/messages` 200 (human confirmation; deferred post-merge by ship-change).

## Discipline checkpoints

- [ ] D1 `doubt-driven-review` — COMPLETE (single + cross-model @propose-review-1); design pivoted to namespace-scoped, `/v1` proxy-gate + guard-last ordering, SPA/auth out of jurisdiction. Re-review if the guard-last ordering or jurisdiction set changes materially.
- [ ] D2 `security-hardening` — STRIDE the jurisdiction matcher (prefix anchoring, no `/api/health` over-match), the `/v1` gate wiring, and deny-by-default within jurisdiction.
- [ ] D3 `scenario-design` — matrix realized (see folded Tests): loopback · trusted · tunnel-authed · tunnel-anon · plugin · /v1 valid/invalid · /api/health · pairing · ws-mint · SPA shell · /auth/status · preflight.

## Validate

- [ ] V1 `openspec validate add-universal-network-guard --strict` passes.
- [ ] V2 `npm test` green (auth, localhost-guard, trusted-networks, ws-upgrade, cors, model-proxy suites).
- [ ] V3 Manual: with auth off over a tunnel — `GET /` and `GET /auth/status` return 200; `POST /api/plugins/automation/create` returns 403; a valid `pi-proxy-*` `/v1/messages` succeeds.
