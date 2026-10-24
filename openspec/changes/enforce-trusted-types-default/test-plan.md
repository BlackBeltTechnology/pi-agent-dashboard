# Test Plan — enforce-trusted-types-default

Stage: design   Generated: 2026-10-24

Hard gate passed. One gap was resolved with the operator: Settings "Default" clears the key by sending `null`, and the server deletes it. All Triple slots are now concrete.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | baseline: Independent Trusted Types mode (resolution) | decision table (env × config × CSP) | L1 | automated | rows: (unset,unset,unset)→enforce; (unset,unset,off)→off; (unset,unset,enforce)→enforce; (` Report `,unset,·)→report; (`OFF`,unset,enforce)→off; (`reprot`,unset,·)→report; (`enforce`,`enforced`,·)→enforce; (unset,`5`,·)→report; (unset,`{}`,·)→report; (`""`,unset,unset)→enforce; (`enforce`,`off`,·)→enforce; (unset,`report`,enforce)→report | `resolveTrustedTypesMode({env,config,cspMode})` | each `mode` as listed; `warnings` = [] for recognized/unset rows, exactly one naming `env` for `reprot`, one naming `config` for `enforced` / `5` / `{}`; no warning text contains the raw value |
| E2 | baseline: config source parsed | EP | L1 | automated | config files with `security.trustedTypes` = `"report"`, `5`, absent | `loadConfig()` | `result.security?.trustedTypes` equals `"report"`, `5`, `undefined` respectively (raw, unvalidated) |
| E3 | baseline: Document states the resolved mode | decision table (CSP × TT) | L1 | automated | CSP {report, enforce} × TT {off, report, enforce}, production (non-dev) response | `plan()` headers + `createIndexHtmlSender({trustedTypesMode})` output | meta `content` equals the TT mode; when TT = enforce, an enforcing header contains `require-trusted-types-for 'script'` (own header if CSP report, appended to strict if CSP enforce); when TT = report, only report-only headers carry it |
| E4 | baseline: resolved once, warnings once | integration | L1 | automated | `createServer` with env unset and config `security.trustedTypes: "enforced"`, env `PI_DASHBOARD_TRUSTED_TYPES=report` | start, `GET /` | header carries the directive only in a report-only policy; meta `content="report"`; log has exactly one warning naming `config`, emitted once at startup and not per request |
| E5 | baseline: config API write semantics | decision table (stored × sent) | L1 | automated | stored {absent, `report`} × sent {`"report"`, `"off"`, `null`}; config also holds `security.otherKey: 1`; a PUT echoing a GET body with `trustedTypesEnvOverride` | `PUT /api/config` | absent→report: restart true; report→report: no TT restart; report→off: restart true; report→null: key removed + restart true; absent→null: no restart; `security.otherKey` still 1; file has no `trustedTypesEnvOverride` |
| E6 | baseline: Config API reports an environment override | EP | L1 | automated | env `report`, unset, `strict` | `GET /api/config` | `trustedTypesEnvOverride` = `"report"`, `null`, `null` |
| E7 | baseline: Development server states the same mode | decision table | L1 | automated | exported `trustedTypesDevPlugin` with (env unset, config unset, CSP unset), (env unset, config unset, CSP off), (env unset, config `report`) | `transformIndexHtml` on a stub index | meta `content` = `enforce`, `off`, `report`; same values `resolveTrustedTypesMode` returns for those inputs |
| E8 | settings-panel: Security page exposes the Trusted Types mode | state-transition (control) | L1 | automated | panel with stored `report`; panel with nothing stored; panel with `trustedTypesEnvOverride: "report"` | select "Report only" + save; select "Default" + save; save untouched; render with override | first save partial `security.trustedTypes: "report"` + restart notice; Default from stored report → `null` + restart notice; untouched → no `security` key; override → control disabled with text "Set by PI_DASHBOARD_TRUSTED_TYPES: Report only"; `CONFIG_FIELD_PAGE.security` = `security` |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | baseline: Document states the resolved mode (no interception) | state-convergence | L3 | automated | docker harness with `PI_DASHBOARD_TRUSTED_TYPES` unset, no `forceTtMode` | load `/` | `meta[name=pi-trusted-types]` = `enforce`; an enforcing response policy contains `require-trusted-types-for 'script'` (shape per harness CSP mode); app renders, 0 page errors |
| F2 | client-trusted-types: Measured violation budget stays in report mode | invariant | L3 | automated | default (enforce) harness; budget spec and `csp-strict-report.spec.ts` WF4 pinned via `forceTtMode(page,"report")` | run both specs | budget: every route 0 violations and `defaultHits` ≤ recorded budget; control step sees exactly 1 violation; WF4 passes |
| F3 | baseline: header readers select by kind | invariant | L3 | automated | default (enforce) harness; `csp.spec.ts`, `runtime-plugin-csp-enforce.spec.ts`, `runtime-plugin-remote-and-paired.spec.ts` with the new guards (`connect-src` / `script-src` / `default-src` selection) | run the three specs, compare skip list against a pre-flip run | all pass; the set of skipped tests equals the pre-flip set |
| F4 | baseline: Runtime plugin loading fits the baseline policy (under TT enforce) | invariant | L3 | automated | `PI_DASHBOARD_CSP=enforce`, TT enforce, trusted runtime plugin with a claim | render the claim | claim renders, its styles apply, 0 CSP and 0 TT violations in the probe |
| F5 | proposal: enforce rehearsal incl. Settings | invariant | L3 | automated | `forceTtMode(page,"enforce")`; routes of `trusted-types-enforce.spec.ts` plus `/settings/security` | load each, open the Trusted Types control | 0 page errors, 0 TT violations; the control is visible and operable |
| F6 | baseline: Changed value requires a restart → document mode | state-transition (save → restart) | L3 | automated | default harness, nothing stored | Settings → Security → "Report only" → Save → `POST /api/restart` → reload | after reload `meta[name=pi-trusted-types]` = `report` and no enforcing policy carries the directive; finally restore Default (null) + restart |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | baseline: Non-string config value cannot crash startup | fault-injection (bad input) | L1 | automated | config `security.trustedTypes` = `{}` (and `5`) | `createServer` start + `GET /` | server starts; header carries the directive only in a report-only policy; exactly one warning naming `config` |

### Manual-only

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| M1 | proposal: pre-flip soak gate | operational evidence | — | manual-only | released build with `add-trusted-types-shadow-enforce` | canary → reset → ≥5 s → graceful restart → ≥14 days spanning ≥1 release → read `cspReports` → closing canary | [judgment over a real 14-day window: all gate counters zero, `ttShadow.since` ≤ window start, both canaries seen; recorded in tasks.md] |
| M2 | design: dev server under enforce | exploratory | — | manual-only | `npm run dev` with TT resolved `enforce` | edit a client file (HMR) and force a compile error (overlay) | [human checks HMR applies and the Vite error overlay renders; no TT errors in the browser console; Vite dev is not in the docker harness] |

---

## Coverage summary

- Requirements covered:
  - baseline-content-security-policy: 3/3 (Independent Trusted Types mode MODIFIED; config API and env override ADDED).
  - settings-panel: 2/2 ADDED.
  - The proposal's soak gate is covered by M1 and F5.
- Scenarios by class: edge 8 · frontend 6 · error 1 · manual 2.
- Scenarios by level: L1 9 · L3 6 · manual 2.
- Scenarios by disposition: automated 15 · manual-only 2.

## New infra needed

- none. F6 uses `POST /api/restart` as other harness specs do (e.g. `tests/e2e/acp-restart-midturn.spec.ts`).
