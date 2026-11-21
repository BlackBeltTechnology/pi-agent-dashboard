# Test Plan — fix-csp-report-delivery

Stage: design   Generated: 2026-11-21

No clarification gaps: every Triple below is concrete.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | baseline-csp: Report destinations are deliverable (report mode) | decision-table (CSP mode × TT mode) | L1 | automated | `registerCsp(fastify, "report", "report")`, production response (not Vite-proxied) | `GET /` | both `Content-Security-Policy-Report-Only` values contain `report-uri /__pi/csp-report/baseline` resp. `…/strict`; no CSP value matches `/report-to/`; `reporting-endpoints` header absent |
| E2 | baseline-csp: same, enforce + TT report (TT-only header) | decision-table | L1 | automated | `registerCsp(fastify, "enforce", "report")` | `GET /` | enforcing `Content-Security-Policy` contains `report-uri /__pi/csp-report/strict`; the TT-only `Content-Security-Policy-Report-Only` contains `report-uri /__pi/csp-report/trusted-types`; no value contains `report-to`; `reporting-endpoints` absent |
| E3 | baseline-csp: same, report + TT enforce (TT-only enforcing header) | decision-table | L1 | automated | `registerCsp(fastify, "report", "enforce")` | `GET /` | the enforcing header carrying `require-trusted-types-for 'script'` alone contains `report-uri /__pi/csp-report/trusted-types` and no `report-to`; `reporting-endpoints` absent |
| E4 | baseline-csp: dev responses unchanged (regression of "Dev mode never feeds the counter") | decision-table | L1 | automated | `registerCsp` with dev on, response marked `markViteProxied` | `GET /` | no header carries `report-uri`, `report-to` or `/__pi/csp-report/`; `reporting-endpoints` absent (existing `csp.test.ts:630-632` keeps passing) |
| E5 | baseline-csp: a route-level `Reporting-Endpoints` is left alone | EP | L1 | automated | a test route that sets `reporting-endpoints: up="/x"` on its reply | `GET` that route under `report` mode | response `reporting-endpoints` equals exactly `up="/x"` (server adds nothing) |
| E6 | live-preview: restricted CSP uses report-uri only | EP | L1 | automated | `buildLiveCsp` for a restricted token with prefix `/live/abc12345/~c/<token>/` | build | `csp` contains `report-uri /live/abc12345/~c/<token>/__pi/csp-report`, contains no `report-to`; result has no `reportingEndpoints` property (`live-preview-policy.test.ts`) |
| E7 | live-preview: open policy unchanged | EP | L1 | automated | `buildLiveCsp` for an open-egress token | build | no `report-uri`, no `report-to`, no `reportingEndpoints` (existing `live-preview-policy.test.ts:110` keeps passing) |
| E8 | live-preview: upstream `Reporting-Endpoints` passes through | EP | L1 | automated | restricted static/port target whose upstream response sets `reporting-endpoints: up="https://example.invalid/r"` | capability `GET` through the proxy | response `reporting-endpoints` equals exactly the upstream value (`live-static-proxy.test.ts`) |
| E9 | live-preview: no upstream header → none added | EP | L1 | automated | restricted target, upstream sets no `reporting-endpoints` | capability `GET` | response has no `reporting-endpoints` header; CSP contains the `report-uri` sink path |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | baseline-csp: real browser violation reaches the counter unmodified | state-convergence | L3 | automated | harness booted `PI_DASHBOARD_CSP=report`, `/` loaded with NO `page.route` rewrite | assert headers of `/` have no `report-to` / `reporting-endpoints`; then `page.evaluate` appends an inline `<script>` | `/api/health` `cspReports.counts.strict["script-src-elem"]` rises by ≥1 within 15 s (poll) |
| F2 | baseline-csp: existing TT + strict delivery path on `/apps/team/`, rewrite removed | state-convergence | L3 | automated | `tests/e2e/csp-strict-report.spec.ts` with its `page.route("**/apps/team/", …)` header rewrite deleted | raw `innerHTML` sink + inline script on `/apps/team/` | the spec's existing counter assertions (TT label `require-trusted-types-for`, strict `script-src-elem`) pass on the unmodified response within their 15 s polls |
| F3 | live-preview: a sandboxed preview's violation reaches its sink | state-convergence | L3 | automated | restricted live preview of a harness static page that, on load, `fetch`es `https://example.invalid/x` (origin not in egress allowance), headers unmodified | open the preview in the viewer | the egress banner shows a row for `https://example.invalid` whose `egress-source` text is `reported by this page` within 15 s |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | baseline-csp: deliverable on Safari | manual cross-engine check | — | manual-only | WebKit not runnable in the local Playwright build (`Unknown setting: PushAPIEnabled`) | on a `report`-mode http install, open `/` in Safari, DevTools console: append an inline `<script>`, wait ≥5 s | [judgment: operator confirms `node soak/csp-soak.mjs canary …` prints `OK: report pipeline delivers` for the Safari run — no harness signal] |
| X2 | baseline-csp: deliverable on Firefox (no harness engine) | manual cross-engine check | — | manual-only | the L3 harness runs Chromium only | same canary as X1 in Firefox | [judgment: operator confirms the canary reports `OK` for the Firefox run] |

---

## Coverage summary

- Requirements covered: 2/2 (baseline-csp "Report destinations are deliverable on plain http"; live-preview "Restricted preview violation reports are deliverable")
- Scenarios by class: edge 9 · perf 0 · frontend 3 · error 2
- Scenarios by level: L1 9 · L2 0 · L3 3
- Scenarios by disposition: automated 12 · manual-only 2

## New infra needed

- none (F3 reuses the live-preview + egress-banner harness of `tests/e2e/canvas-egress-banner.spec.ts`)
