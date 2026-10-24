# Test Plan — enforce-strict-csp-default

Stage: design   Generated: 2026-10-25

Hard gate passed. Two gaps resolved with the operator:
- The unrecognized-value warning names `PI_DASHBOARD_CSP`, the accepted values `off|report|enforce` and the resolved mode `enforce`, and never contains the raw value (sibling parity, log-injection hygiene).
- `scripts/e2e-csp-lane-check.mjs` fails on a report with 0 tests, and when a spec named via `--require` is absent from the report.

All Triple slots are concrete. The soak gate (tasks § 1) is pre-code operator evidence, not a test scenario, and is not catalogued here.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | baseline: Staged CSP mode resolution (parse + warning) | EP + decision table | L1 | automated | `PI_DASHBOARD_CSP` ∈ {unset, `""`, `Enforce`, `ENFORCE`, ` enforce`, `1`, `garbage`, `REPORT`, `reprot`, `report`, `enforce`, `off`} | `resolveCspMode(raw)` and `cspModeWarning(raw)` | mode `enforce` for every value except exact `report` → `report` and exact `off` → `off`; warning `undefined` for unset, `""`, `report`, `enforce`, `off`; for every other value a string containing `PI_DASHBOARD_CSP`, `off`, `report`, `enforce` and the resolved mode `enforce`, and not containing the raw value (checked for `garbage`, `reprot`, `REPORT`) |
| E2 | baseline: Default enforces the strict policy on dashboard-owned responses | decision table (default CSP × derived TT) | L1 | automated | CSP mode `resolveCspMode(undefined)`, TT mode from the resolver as `server.ts` calls it with TT unset; production (not Vite-proxied) HTML response with import map | `registerCsp` + `GET /` | one enforcing `Content-Security-Policy` whose `script-src` is `'self' 'nonce-<n>'` with no `'unsafe-inline'` / `'unsafe-eval'`; `<n>` equals the import-map `nonce` attribute; no `Content-Security-Policy-Report-Only` header carries the `baseline` policy; the TT directive sits where `plan()` places it for the derived TT mode (today: a TT-only Report-Only header naming `/__pi/csp-report/trusted-types`) |
| E3 | baseline: route-level policy independent of the mode (under the new default) | EP | L1 | automated | default CSP mode; a `ctx.serveApp` mount response with its own `Content-Security-Policy`; a `/live/<id>/` response; a non-HTML `/api/health` response | `GET` each | mount: its own policy value unchanged, no strict header added; `/live/`: no dashboard CSP header; `/api/health`: enforcing strict header without a nonce |
| E4 | baseline: Dev mode is decided per response (under the new default) | decision table | L1 | automated | default CSP mode; one response marked `markViteProxied`, one server-owned response in the same dev run | `GET` both | proxied: enforcing `Content-Security-Policy` carrying the `baseline` policy (legacy `script-src` with `'unsafe-inline'`), no strict policy, no `report-uri` / `report-to` / `/__pi/csp-report/`; server-owned: the E2 header shape |
| E5 | baseline: Mistyped value warns once at startup / Unset or empty does not warn | state (boot → requests) | L1 | automated | `createServer` with `PI_DASHBOARD_CSP=reprot`; second boot with `PI_DASHBOARD_CSP=""` | start, then 3× `GET /` | first boot: exactly 1 warning call matching E1's text, 0 more after the 3 requests, responses carry the enforcing strict header; second boot: 0 such warnings |
| E6 | proposal: report-lane zero-skip check | decision table | L1 | automated | Playwright JSON fixture captured from the installed reporter on a throwaway spec with one test skipped with a `PI_DASHBOARD_CSP` message, one skipped for an unrelated reason, one passing; plus an empty report (0 tests) and a report lacking a `--require`d spec | `node scripts/e2e-csp-lane-check.mjs <report> [--allow a,b] [--require x,y]` | fixture, no `--allow`: exit 1; fixture with `--allow <that spec>`: exit 0; fixture minus the CSP skip: exit 0; any `stats.unexpected > 0`: exit 1; 0 tests: exit 1; `--require` naming a spec not in the report: exit 1 |
| E7 | proposal: CI coverage of the report lane | contract | ci | automated | `.github/workflows/ci-e2e-browser.yml` | `packages/shared/src/__tests__/e2e-browser-workflow-contract.test.ts` | job `e2e-csp-report-lane` exists; has job-level `timeout-minutes`, the PR-path `continue-on-error`, the `e2e-browser` label gate; its env sets `PI_DASHBOARD_CSP: "report"` and `PI_E2E_SEED: "1"`; it runs `scripts/e2e-csp-lane-check.mjs` with `--require` listing every report-lane member |
| E8 | proposal: Rollback knob for docker installs | contract | L1 | automated | `docker/compose.yml` | parse with `yaml`, read the dashboard service `environment` | `PI_DASHBOARD_CSP` present with value `${PI_DASHBOARD_CSP:-}` |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | baseline: Default enforces the strict policy (harness, `""` path) | invariant | L3 | automated | docker harness with `PI_DASHBOARD_CSP` unset (`test-up.sh` passes `""`), `PI_E2E_SEED=1` | load `/`, open a session view | response has an enforcing `Content-Security-Policy` with strict `script-src` + nonce, no `baseline` Report-Only header; the app renders and its same-origin WebSocket connects; 0 `securitypolicyviolation` events; `csp-strict-enforce.spec.ts` reports 0 skipped |
| F2 | baseline: Runtime plugin loading fits the baseline policy (under the default) | invariant | L3 | automated | default harness, trusted runtime canary claim staged | render the claim | claim renders with its styles; 0 CSP violations; `runtime-plugin-csp-enforce.spec.ts` reports 0 skipped |
| F3 | baseline: Explicit report stays available (report lane) | invariant | L3 | automated | harness with `PI_DASHBOARD_CSP=report` | run `csp-strict-report.spec.ts` | WF1/WF4 pass: baseline and strict Report-Only headers each name their own sink; 0 tests skipped |
| F4 | cross-origin-client: Cross-origin switch from a report-mode host | invariant | L3 | automated | harness with `PI_DASHBOARD_CSP=report`; report-lane members (`runtime-plugin-remote-and-paired.spec.ts` F14 + AF1–AF5, `known-server-stale-name.spec.ts`, plus any 3.1 finds) | run the members | all pass with 0 tests skipped for a `PI_DASHBOARD_CSP` reason; lane check with `--require <members>` exits 0 |
| F5 | cross-origin-client: Cross-origin switch from an enforcing host is refused | fault-injection (policy) | L3 | automated | default (enforcing) harness; page at `http://localhost:<dashboardPort>/` | in page, `fetch("http://127.0.0.1:<dashboardPort>/api/health")` and load `<img src="http://127.0.0.1:<dashboardPort>/favicon.ico">` | the fetch rejects with `TypeError`; `securitypolicyviolation` events fire with `effectiveDirective` `connect-src` and `img-src`; no request reaches the server for the fetch (no matching access) |
| F6 | proposal: report-lane members skip with a CSP reason under the default | invariant | L3 | automated | default (enforcing) harness | run the report-lane members | every member test is skipped with a message containing `PI_DASHBOARD_CSP`; 0 failed; lane check with `--allow <members>` exits 0 |
| F7 | baseline: Dev mode under the default (HMR) | smoke | — | manual-only | `pi-dashboard --dev` with `PI_DASHBOARD_CSP` unset | load the dashboard, edit a client component | HMR applies the edit, page renders, console shows no CSP violation (header shape automated in E4; no Vite-dev E2E harness exists) |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | proposal: Rollback by environment + stop/start (CLI daemon) | state-transition (enforce → report) | L2 | automated | daemon started with `PI_DASHBOARD_CSP` unset | `pi-dashboard stop`, then `PI_DASHBOARD_CSP=report pi-dashboard start`; separately `export PI_DASHBOARD_CSP=report; pi-dashboard restart` | after stop + start, `/` carries two `Content-Security-Policy-Report-Only` headers (baseline + strict) and no enforcing one; the `restart` outcome (picks up the value or not) is printed and recorded for docs |
| X2 | proposal: Rollback per install type (service, Electron, docker) | state-transition | — | manual-only | install of each type running with the default | apply `PI_DASHBOARD_CSP=report` by that type's documented path, restart | `/` carries the two Report-Only headers; documented procedure recorded per type (real service / Electron / docker installs; not automatable in CI) |
| X3 | baseline: Mistyped rollback value does not relax | fault-injection (bad input) | L2 | automated | daemon restarted via stop + start with `PI_DASHBOARD_CSP=REPORT` | load `/`, read `~/.pi/dashboard/server.log` lines added since start | `/` still carries the enforcing strict header; exactly one new warning line matching E1's text; the raw value `REPORT` does not appear in it |

---

## Coverage summary

- Requirements covered: 11/11. Delta "Staged CSP mode resolution": 8 scenarios (E1–E5, F1, F3, X3). ADDED "Cross-origin API base depends on the serving host's CSP mode": 4 scenarios (F4, F5, F6; the dashboard-served `VITE_API_URL` scenario is the same equivalence class as F5, since the same served policy refuses the same cross-origin request). Same-origin in every mode: F1 (enforce) + F3 (report). Proposal items: rollback (X1, X2, E8), report-lane CI (E6, E7), unchanged mode paths under the default (E3, E4, F2, F7).
- Scenarios by class: edge 8 · perf 0 · frontend 7 · error 3
- Scenarios by level: L1 7 · L2 2 · L3 6 · ci 1 · — 2
- Scenarios by disposition: automated 16 · manual-only 2

## New infra needed

- `scripts/e2e-csp-lane-check.mjs` (small node script, no deps), covered by E6.
- CI job `e2e-csp-report-lane` in `ci-e2e-browser.yml` (a new variant-harness leg on the existing pattern), covered by E7.
