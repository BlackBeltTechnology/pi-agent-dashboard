## 1. Dashboard CSP: report-uri only

- [x] 1.1 Test (test-plan #E1), see packages/server/src/__tests__/csp.test.ts (rewrite the `report-to csp-*` / `reporting-endpoints` assertions at `:363-381`): input `registerCsp(fastify, "report", "report")`, production response · trigger `GET /` · observable both Report-Only values contain `report-uri /__pi/csp-report/baseline` resp. `…/strict`, no CSP value matches `/report-to/`, `reporting-endpoints` header absent. Verify it fails before 1.6
- [x] 1.2 Test (test-plan #E2), see packages/server/src/__tests__/csp.test.ts: input `registerCsp(fastify, "enforce", "report")` · trigger `GET /` · observable enforcing header contains `report-uri /__pi/csp-report/strict`, the TT-only Report-Only header contains `report-uri /__pi/csp-report/trusted-types`, no value contains `report-to`, `reporting-endpoints` absent
- [x] 1.3 Test (test-plan #E3), see packages/server/src/__tests__/csp.test.ts (`:381` TT-only case): input `registerCsp(fastify, "report", "enforce")` · trigger `GET /` · observable the enforcing header carrying `require-trusted-types-for 'script'` alone contains `report-uri /__pi/csp-report/trusted-types` and no `report-to`, `reporting-endpoints` absent
- [x] 1.4 Test (test-plan #E4), see packages/server/src/__tests__/csp.test.ts:630-632: input dev on, response marked `markViteProxied` · trigger `GET /` · observable no header carries `report-uri`, `report-to` or `/__pi/csp-report/`, `reporting-endpoints` absent (regression; must stay green)
- [x] 1.5 Test (test-plan #E5), see packages/server/src/__tests__/csp.test.ts (route-level policy cases near `:584`): input a test route setting `reporting-endpoints: up="/x"` · trigger `GET` it in `report` mode · observable response `reporting-endpoints` equals exactly `up="/x"`
- [x] 1.6 Implement: `packages/server/src/auth/csp.ts` `registerCsp` appends `; report-uri ${cspReportPath(label)}` only (`:155`) and drops the `reporting-endpoints` block (`:159-160`); remove `cspReportEndpointName` from `packages/server/src/auth/csp-report-paths.ts:28-29` and its import (`csp.ts:41`); update the header doc comment (`csp.ts:31-32`). Verify 1.1–1.5 pass and `tsc --noEmit` on packages/server is clean

## 2. Live-preview CSP: report-uri only

- [x] 2.1 Test (test-plan #E6), see packages/server/src/__tests__/live-preview-policy.test.ts:87: input `buildLiveCsp` for a restricted token, prefix `/live/abc12345/~c/<token>/` · trigger build · observable `csp` contains `report-uri …/__pi/csp-report`, no `report-to`, result has no `reportingEndpoints` property. Verify it fails before 2.5
- [x] 2.2 Test (test-plan #E7), see packages/server/src/__tests__/live-preview-policy.test.ts:110: input `buildLiveCsp` for an open-egress token · trigger build · observable no `report-uri`, no `report-to`, no `reportingEndpoints` (regression)
- [x] 2.3 Test (test-plan #E8), see packages/server/src/__tests__/live-static-proxy.test.ts:394: input restricted target whose upstream sets `reporting-endpoints: up="https://example.invalid/r"` · trigger capability `GET` · observable response `reporting-endpoints` equals exactly the upstream value
- [x] 2.4 Test (test-plan #E9), see packages/server/src/__tests__/live-static-proxy.test.ts: input restricted target, no upstream `reporting-endpoints` · trigger capability `GET` · observable no `reporting-endpoints` header, CSP contains the `report-uri` sink path
- [x] 2.5 Implement: `packages/server/src/live-server/live-csp.ts` drops `"report-to csp"` (`:90`) and the `reportingEndpoints` field (`:31-32,92`); `packages/server/src/live-server/live-server-proxy.ts` drops the merge (`:163-174`) and the set (`:243`); update `packages/server/src/live-server/live-csp-report.ts:3` wording. Verify 2.1–2.4 pass

## 3. Browser delivery (L3)

- [x] 3.1 Test (test-plan #F1), see tests/e2e/csp-strict-report.spec.ts (harness boot + `readCspReports` / `countOf`): input harness `PI_DASHBOARD_CSP=report`, `/` loaded with NO `page.route` rewrite · trigger assert `/` headers carry no `report-to` and no `reporting-endpoints`, then append an inline `<script>` via `page.evaluate` · observable `/api/health` `cspReports.counts.strict["script-src-elem"]` rises by ≥1 within a 15 s poll
- [x] 3.2 Test (test-plan #F2), see tests/e2e/csp-strict-report.spec.ts:68-82: input the spec with its `page.route("**/apps/team/", …)` header rewrite and its comment deleted · trigger the existing raw `innerHTML` sink + inline script on `/apps/team/` · observable the existing TT-label and strict counter assertions pass on the unmodified response within their 15 s polls
- [x] 3.3 Test (test-plan #F3), see tests/e2e/canvas-egress-banner.spec.ts (live preview + egress banner): input a restricted live preview of a harness static page that `fetch`es `https://example.invalid/x` on load, headers unmodified · trigger open the preview in the viewer · observable the egress banner shows a row for `https://example.invalid` whose `egress-source` text is `reported by this page` within 15 s
- [x] 3.4 Run the CSP report lane locally (`PI_DASHBOARD_CSP=report`, managed harness) for `csp-strict-report.spec.ts`, the 3.1 spec and the 3.3 spec; verify all pass with zero header rewriting in the specs (`rg "report-to" tests/e2e` finds only assertions of absence)

## 4. Docs

- [x] 4.1 Update the AGENTS rows naming the removed mechanism: `packages/server/src/auth/csp.ts.AGENTS.md`, `packages/server/src/auth/AGENTS.md` (csp-report-paths row: `cspReportEndpointName` gone), `packages/server/src/live-server/AGENTS.md` (live-csp row); add `See change: fix-csp-report-delivery`
- [x] 4.2 Delegate to DocScribe (caveman style): `docs/architecture.md` § Baseline CSP — report destination is `report-uri` only; why (`report-to` + `Reporting-Endpoints` never delivered on plain http in Chrome 157 / Firefox 153); `docs/faq.md` CSP lane entry — the report lane no longer rewrites headers
- [x] 4.3 CHANGELOG `## [Unreleased]` → `### Fixed`: CSP violation reports now reach the dashboard on plain-http installs (Chromium and Firefox dropped them while `report-to` was set)

## 5. Verify

- [x] 5.1 `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log`; verify the csp / live-preview / live-static-proxy / csp-report-sink suites pass and no failure is new versus develop
- [x] 5.2 Manual (test-plan: manual-only, #X1): Safari on a `report`-mode http install, DevTools console appends an inline `<script>`, wait ≥5 s; verify `node openspec/changes/enforce-strict-csp-default/soak/csp-soak.mjs canary <name>` prints `OK: report pipeline delivers`
- [x] 5.3 Manual (test-plan: manual-only, #X2): the same canary in Firefox; verify `OK: report pipeline delivers`
