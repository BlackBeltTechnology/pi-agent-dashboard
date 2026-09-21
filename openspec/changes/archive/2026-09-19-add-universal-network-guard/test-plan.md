# Test Plan — add-universal-network-guard

Scenarios derived from `specs/trusted-networks/spec.md` + `design.md` via
decision-table / state-transition / boundary techniques. Stance: falsify (find
the input+trigger that makes the guard wrong — either a hole or a lockout).

Levels (this repo): **L1** vitest `packages/server/src/__tests__/*.test.ts`
(most guard logic is `fastify.inject()`-testable); **L3** Playwright
`tests/e2e/*.spec.ts` vs the docker harness (rendered/end-to-end confidence,
port from `.pi-test-harness.json`); **manual-only** = human/real-tunnel.

No clarification gaps: every Triple below fills from the spec.

| id | class | technique | level | disposition | input · trigger · observable |
|----|-------|-----------|-------|-------------|------------------------------|
| S1 | edge | decision-table | L1 | automated | guard installed, `/api/sessions` route has NO per-route preHandler · request from untrusted public IP (`x-forwarded-for`), no cookie · **403** `network_not_allowed` |
| S2 | state | state-transition | L1 | automated | hooks registered bearer→oauth→proxy→guard(last) · request with valid bearer · guard reads `isAuthenticated=true`, **allows** |
| S3 | edge | decision-table | L1 | automated | auth OFF · proxied/tunnel request (forwarding headers) to `POST /api/plugins/automation/create` · **403**, no automation file written, no agent spawned |
| S4 | edge | decision-table | L1 | automated | auth OFF · untrusted unauth `PUT /api/provider-auth/api-key` · **403** |
| S5 | edge | decision-table | L1 | automated | auth OFF · genuine-local loopback (`127.0.0.1`, no forwarding headers) to a guarded route · **allowed** (not 403) |
| S6 | edge | decision-table | L1 | automated | auth OFF · unauth untrusted `GET /api/health` · **allowed** (in-namespace exception) |
| S7 | edge | decision-table | L1 | automated | unauth `POST /api/pair/redeem` (a `PUBLIC_PAIRING_PREFIXES` path) · **allowed** (reaches handler, not network-403) |
| S8 | edge | decision-table | L1 | automated | unauth untrusted request to the `/api` ws-ticket **mint** endpoint · **403** (mint is guarded, not public) |
| S9 | edge | decision-table | L1 | automated | auth OFF · unauth untrusted `GET /` · **200** SPA index (out of jurisdiction, served) |
| S10 | state | state-transition | L1 | automated | unauth `GET /settings` served via `setNotFoundHandler` fallback · **200** SPA index |
| S11 | edge | decision-table | L1 | automated | unauth `GET /auth/status` · **200** (client can detect auth-enabled state) |
| S12 | edge | decision-table | L1 | automated | valid `pi-proxy-*` key · `POST /v1/messages` · proxy gate sets `isAuthenticated=true`, guard **allows**, request proxied |
| S13 | edge | decision-table | L1 | automated | no/invalid credential from untrusted IP · `GET /v1/models` · **rejected** (401 by gate / 403 by guard), not silently allowed |
| S14 | edge | decision-table | L1 | automated | modelProxy **disabled** · untrusted `/v1/anything` · **not admitted** by any public `/v1` bypass (403/404) |
| S15 | edge | fault/decision | L1 | automated | allowed origin · `OPTIONS /api/sessions` preflight · CORS layer answers (**204/200**), guard does NOT 403 it |
| S16 | config | boundary | L1 | automated | modelProxy `secondPort` enabled · server start · second Fastify instance listens on **`127.0.0.1`** only (asserted) |
| S17 | invariant | coverage | L1 | automated | enumerate the route table · every non-static/non-`/auth`/non-public route · resolves under `/api`,`/v1`,`/editor`,`/live`, else **test fails** |
| S18 | error | fault/log | L1 | automated | guard denies `203.0.113.5` → `/api/sessions` · log line contains **path+ip+reason**, and **no** request body or token |
| S19 | edge | boundary | L1 | automated | unauth untrusted · `GET /api/health?probe=1` · **allowed** (pathname match) AND `GET /api/healthz` · **403** AND `GET /apiv2/x` · out of jurisdiction (anchored prefix) |
| S20 | integration | end-to-end | L3 | automated | docker harness, auth OFF, over the proxied frontend · `GET /` · **200** app shell AND `POST /api/plugins/automation/create` · **403** (flagship: shell loads, RCE route closed) |
| S22 | edge | decision-table | L1 | automated | `auth.bypassUrls` matches a route that also carries a per-route `networkGuard` · untrusted unauth request · still **403** (exception does not widen guarded routes — same as today) |
| S23 | error | fault/contract | L1 | automated | guard denies an in-jurisdiction request · response body is the existing `network_not_allowed` shape AND the denial appears in `GET /api/tunnel/block-events` |
| S24 | invariant | coverage | L1 | automated | coverage test **with plugin routes loaded** · `/mcp*` admitted only via the enumerated independently-authenticated entry; every `/mcp*` route (incl. bare `/mcp`) requires device-token auth; `/sw.js` in static-allow; no client SPA route under a guarded namespace |
| S25 | edge | boundary | L1 | automated | `HEAD /api/health` · **allowed**; unparseable URL · **denied** (fail-closed); CIDR added to trusted set at runtime · **admits without restart** |
| S21 | smoke | manual | — | manual-only | real zrok tunnel, auth OFF · manual browse · `GET /` 200, automation/create 403, valid `pi-proxy` `/v1/messages` 200 (human confirmation over a real tunnel) |

## New infra needed
None. L1 reuses `fastify.inject()` (sibling suites already do). L3 reuses the
existing docker harness (`tests/e2e/`).

## Disposition summary
- **automated:** S1–S20, S22–S25 (23 L1 + 1 L3)
- **manual-only:** S21 (deferred to post-merge by `ship-change`)
