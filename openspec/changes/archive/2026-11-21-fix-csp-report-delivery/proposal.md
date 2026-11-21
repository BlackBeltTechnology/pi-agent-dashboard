# Proposal

## Why

Chromium and Firefox never deliver the dashboard's CSP violation reports on a plain-`http` install. Every policy carries `report-to` plus a `Reporting-Endpoints` header, so the browser takes the Reporting API path and never sends the report, ignoring the `report-uri` fallback (measured 2026-11-21: Chrome 157, Firefox 153; evidence on branch `os/enforce-strict-csp-default`, see design). The `v0.11.0` install that should have opened the `enforce-strict-csp-default` soak counted **zero** browser reports between 2026-10-25 and 2026-11-21. That soak gate (14 days of report-mode evidence before strict CSP enforces by default) cannot produce evidence until reports arrive, so this fix must ship in a release first.

## What Changes

- The dashboard CSP headers (`baseline`, `strict`, `trusted-types` labels; `packages/server/src/auth/csp.ts`) name their sink with `report-uri` only. `report-to` and the `Reporting-Endpoints` response header are no longer emitted.
- The live-preview restricted CSP (`packages/server/src/live-server/live-csp.ts`) does the same. It drops `report-to csp`, and the proxy stops adding a `Reporting-Endpoints` entry to upstream responses.
- No sink change: `POST /__pi/csp-report/:policy` and the live-preview sink already accept `application/csp-report`, the body `report-uri` delivery sends.
- `tests/e2e/csp-strict-report.spec.ts` stops rewriting the document response to strip `report-to`. The real header now has to deliver on its own, so the E2E covers what production does.
- E2E checks that a CSP violation reaches its sink with unmodified headers: on `/` in `report` mode, and from a restricted live preview.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `baseline-content-security-policy`: every emitted report destination SHALL be one browsers deliver on plain `http`. The policies use `report-uri` only; no `report-to`, no `Reporting-Endpoints`.
- `live-server-preview`: the restricted preview CSP names its egress-violation sink with `report-uri` only.

## Impact

- Code: `packages/server/src/auth/csp.ts` (`registerCsp`), `packages/server/src/auth/csp-report-paths.ts` (`cspReportEndpointName` becomes unused and is removed), `packages/server/src/live-server/live-csp.ts` (`buildLiveCsp`, `reportingEndpoints` field), `packages/server/src/live-server/live-server-proxy.ts` (header merge).
- Tests: `packages/server/src/__tests__/csp.test.ts`, `live-preview-policy.test.ts`, `live-static-proxy.test.ts`, `tests/e2e/csp-strict-report.spec.ts`; new E2E for `/` and for a restricted preview.
- Docs: stale wording in `csp.ts:31-32`, `live-csp-report.ts:3` and three AGENTS rows (design D4).
- Behaviour: violation counters on `/api/health` (`cspReports`) start counting real browser reports on http installs. No auth, route or mode change. `report-uri` is deprecated in CSP3 but measured delivering in Chrome 157 and Firefox 153. Safari is unverified locally and gets a manual check.
- Unblocks: `enforce-strict-csp-default` soak (its open tag must contain this fix).

## Discipline Skills

- `security-hardening`: the change touches CSP headers and an unauthenticated report sink (untrusted input). The sink is unchanged, but its traffic goes from none to real.
- `observability-instrumentation`: the change exists to make violation counters actually observable. Verification has to prove a real browser report arrives.
