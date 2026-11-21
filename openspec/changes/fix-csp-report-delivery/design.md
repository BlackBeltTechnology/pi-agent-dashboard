# Design — fix-csp-report-delivery

## Context

`harden-cors-and-csp-reporting` (archived 2026-10-23, design D9/D10) made every emitted policy carry both destinations, declared in a `Reporting-Endpoints` header:

- `packages/server/src/auth/csp.ts:155`: `${value}; report-uri ${cspReportPath(label)}; report-to ${cspReportEndpointName(label)}`
- `packages/server/src/auth/csp.ts:159-160`: `reporting-endpoints: csp-<label>="/__pi/csp-report/<label>", …` when any label was used
- `packages/server/src/live-server/live-csp.ts:89-92`: restricted preview CSP `report-uri <reportPath>; report-to csp`, returning `reportingEndpoints: csp="<reportPath>"`
- `packages/server/src/live-server/live-server-proxy.ts:163-174,243`: appends that entry to the upstream's `reporting-endpoints` header, or sets it

When `report-to` names an endpoint declared in `Reporting-Endpoints`, Chromium uses the Reporting API and ignores `report-uri`. Measured 2026-11-21 (evidence: `openspec/changes/enforce-strict-csp-default/soak-evidence.md` § Blocking finding, on branch `os/enforce-strict-csp-default` at `486565b7e`; not yet on `develop`):

| Browser | Header shape on `http://localhost` | Delivered |
|---|---|---|
| Playwright Chromium 151 headless, Chrome 157 headless | dashboard as-is | no; CDP shows the report `Pending` → `Queued`, never sent (75 s / 131 s) |
| Chrome 157, local test server | `report-uri` + `report-to` + relative `Reporting-Endpoints` | no (90 s) |
| Chrome 157, local test server | `report-to` + absolute `http://localhost:…` endpoint | no (100 s) |
| Chrome 157, local test server | `report-uri` only | yes, immediately, `application/csp-report` |
| Firefox 153 (Playwright), local test server | `report-uri` + `report-to` + `Reporting-Endpoints` | no (8 s) |
| Firefox 153 (Playwright), local test server | `report-uri` only | yes, `application/csp-report` |
| WebKit (Playwright 26.5) | either | not measurable here: `newPage` fails (`Unknown setting: PushAPIEnabled`, build mismatch); unverified |

Production telemetry (external evidence, recorded in the soak-evidence snapshot `soak/canary-open.json` on that branch): the `v0.11.0` install counted no reports for any label from 2026-10-25 to 2026-11-21. Over the same period the in-page Trusted Types shadow counted 34346 `would-alter-html`.

The E2E masked it. `tests/e2e/csp-strict-report.spec.ts:68-82` rewrites the document response to drop `report-to` and `Reporting-Endpoints`, noting that the Reporting API "delivered nothing within 2 minutes". So the delivery path the test proves differs from the one production uses.

The sinks already accept the `report-uri` body. The design of `harden-cors-and-csp-reporting` (line 89) specifies `application/csp-report` | `application/reports+json`, and `packages/server/src/live-server/live-egress.ts:109-118` parses both shapes for the preview sink.

## Goals / Non-Goals

- Goal: on a plain-`http` install, a CSP violation in Chromium and Firefox (measured) reaches `/__pi/csp-report/<label>` (and the preview sink), so the counters reflect real traffic.
- Goal: the E2E exercises the real header, unmodified.
- Safari/WebKit: expected to deliver `report-uri` (the shape the CSP2 spec defines), but unverified locally. The change does not claim it; the manual verification checklist covers one Safari run.
- Non-goal: changing sinks, labels, counters, modes, route tiers or the `/api/csp-violations` client channel. (`packages/server/src/routes/csp-violations-routes.ts:8-9` is a separate, authenticated channel.)
- Non-goal: Reporting API support on https. It was not measurable locally, and one shape everywhere is simpler than a per-request branch.

## Decisions

### D1. `report-uri` only; drop `report-to` and `Reporting-Endpoints`

`csp.ts` appends `; report-uri <path>` only and never sets `reporting-endpoints`. `cspReportEndpointName` (`packages/server/src/auth/csp-report-paths.ts:28-29`) loses its last caller and is removed. `buildLiveCsp` drops `report-to csp` and the `reportingEndpoints` field, and `live-server-proxy.ts` drops the merge and set.

Alternative rejected: keep `report-to` on https only. That's a per-request branch keyed on transport, and in this deployment the transport is proxy-dependent (zrok terminates TLS). Its benefit is unverified, and Chromium falls back to `report-uri` only when `report-to` is absent. Trade-off: `report-uri` is deprecated in CSP Level 3. If a browser drops it, delivery stops again. The E2E below (D2) is the tripwire for Chromium only, because the harness runs Chromium. A Firefox or Safari removal would go unnoticed until someone re-runs the manual check: an accepted residual risk.

### D2. E2E proves delivery with the real header

`csp-strict-report.spec.ts` drops its `page.route` header rewrite and asserts the counters move on the unmodified response. A new E2E asserts the same on `/` (the document the soak exercises), and one asserts that a sandboxed restricted preview's violation reaches its capability sink. The `live` scope of the origin gate admits `Origin: null` (`openspec/specs/cross-site-request-gate/spec.md`, "Opaque `null` Origin is scope-dependent"), and the token in the path is the credential (`packages/server/src/live-server/live-server-proxy.ts:302-303`), but only a real browser proves the POST is accepted. It also asserts no `report-to` token and no `reporting-endpoints` header on `/`. If a future change reintroduces `report-to`, or a browser stops honouring `report-uri`, this spec fails rather than silently passing.

### D3. Header-shape assertions move to L1

`csp.test.ts` and `live-preview-policy.test.ts` / `live-static-proxy.test.ts` currently assert `report-to csp-*` and `reporting-endpoints` (`csp.test.ts:363-381`, `live-preview-policy.test.ts:87`, `live-static-proxy.test.ts:394`). They flip to asserting each destination is `report-uri` only, with no `reporting-endpoints`. The dev-mode and route-level absence tests (`csp.test.ts:422,584,630-632`) stay as they are.

### D4. Stale wording removed in the same change

Doc comments and AGENTS rows that describe the removed mechanism are updated together: `packages/server/src/auth/csp.ts:31-32`, `packages/server/src/live-server/live-csp-report.ts:3`, `packages/server/src/auth/csp.ts.AGENTS.md`, `packages/server/src/auth/AGENTS.md`, `packages/server/src/live-server/AGENTS.md`. `packages/server/src/routes/csp-violations-routes.ts:8-9` explains why that client channel is authenticated rather than a `report-uri` sink. That rationale still holds and stays.

## Risks

- **A route-level policy or upstream that sets its own `Reporting-Endpoints`.** `live-server-proxy.ts:172-174` merged ours into an upstream value. After this change the upstream's header passes through untouched, and ours is simply not added.
- **Report volume.** Reports now actually arrive, so the sink sees real traffic for the first time. Its existing caps are unchanged: refusal order 404 → 405 → 429 (per-peer `PeerLimiter`) → 415 → 413 / 408 / 400, with limiter, size-cap and deadline refusals bumping the persisted `dropped` counter (`packages/server/src/auth/csp-report-sink.ts:15-16,216,244`). `security-hardening` review checks that the sink limits hold under that volume.
- **Rollout.** The fix needs a release before the `enforce-strict-csp-default` soak can open on it (its 1.1 open tag moves to that release).
