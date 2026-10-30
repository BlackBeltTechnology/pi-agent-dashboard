# Test Plan — enforce-trusted-types-default

Stage: design   Generated: 2026-10-24   Amended 2026-10-30 (scope split: default stays `report`; flip moved to `flip-trusted-types-default-enforce`)

Hard gate passed. One gap was resolved with the operator: Settings "Default" clears the key by sending `null`, and the server deletes it. All Triple slots are now concrete.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | baseline: Independent Trusted Types mode (resolution) | decision table (env × config × CSP) | L1 | automated | rows: (unset,unset,unset)→report; (unset,unset,off)→off; (unset,unset,enforce)→report; (` Report `,unset,·)→report; (`OFF`,unset,enforce)→off; (`reprot`,unset,·)→report; (`enforce`,`enforced`,·)→enforce; (unset,`5`,·)→report; (unset,`{}`,·)→report; (`""`,unset,unset)→report; (unset,`enforce`,unset)→enforce; (`enforce`,`off`,·)→enforce; (unset,`report`,enforce)→report | `resolveTrustedTypesMode({env,config,cspMode})` | each `mode` as listed; `warnings` = [] for recognized/unset rows, exactly one naming `env` for `reprot`, one naming `config` for `enforced` / `5` / `{}`; no warning text contains the raw value |
| E2 | baseline: config source parsed | EP | L1 | automated | config files with `security.trustedTypes` = `"report"`, `5`, absent | `loadConfig()` | `result.security?.trustedTypes` equals `"report"`, `5`, `undefined` respectively (raw, unvalidated) |
| E3 | baseline: Document states the resolved mode | decision table (CSP × TT) | L1 | automated | CSP {report, enforce} × TT {off, report, enforce}, production (non-dev) response | `plan()` headers + `createIndexHtmlSender({trustedTypesMode})` output | meta `content` equals the TT mode; when TT = enforce, an enforcing header contains `require-trusted-types-for 'script'` (own header if CSP report, appended to strict if CSP enforce); when TT = report, only report-only headers carry it |
| E4 | baseline: resolved once, warnings once | integration | L1 | automated | `createServer` with env unset and config `security.trustedTypes: "enforced"`, env `PI_DASHBOARD_TRUSTED_TYPES=report` | start, `GET /` | header carries the directive only in a report-only policy; meta `content="report"`; log has exactly one warning naming `config`, emitted once at startup and not per request |
| E5 | baseline: config API write semantics | decision table (stored × sent) | L1 | automated | stored {absent, `report`} × sent {`"report"`, `"off"`, `null`}; config also holds `security.otherKey: 1`; a PUT echoing a GET body with `trustedTypesEnvOverride` | `PUT /api/config` | absent→report: restart true; report→report: no TT restart; report→off: restart true; report→null: key removed + restart true; absent→null: no restart; `security.otherKey` still 1; file has no `trustedTypesEnvOverride` |
| E6 | baseline: Config API reports an environment override | EP | L1 | automated | env `report`, unset, `strict` | `GET /api/config` | `trustedTypesEnvOverride` = `"report"`, `null`, `null` |
| E7 | baseline: Development server states the same mode | decision table | L1 | automated | exported `trustedTypesDevPlugin` with (env unset, config unset, CSP unset), (env unset, config unset, CSP off), (env unset, config `enforce`) | `transformIndexHtml` on a stub index | meta `content` = `report`, `off`, `enforce`; same values `resolveTrustedTypesMode` returns for those inputs |
| E8 | settings-panel: Security page exposes the Trusted Types mode | state-transition (control) | L1 | automated | panel with stored `report`; panel with nothing stored; panel with `trustedTypesEnvOverride: "report"` | select "Report only" + save; select "Default" + save; save untouched; render with override | first save partial `security.trustedTypes: "report"` + restart notice; Default from stored report → `null` + restart notice; untouched → no `security` key; override → control disabled with text "Set by PI_DASHBOARD_TRUSTED_TYPES: Report only"; `CONFIG_FIELD_PAGE.security` = `security` |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F6 | baseline: Changed value requires a restart → document mode | state-transition (save → restart) | L3 | automated | default harness, nothing stored | Settings → Security → "Enforce" → Save → `POST /api/restart` → reload | after reload `meta[name=pi-trusted-types]` = `enforce` and an enforcing policy carries `require-trusted-types-for 'script'`; finally restore Default (null) + restart and `meta` = `report` |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | baseline: Non-string config value cannot crash startup | fault-injection (bad input) | L1 | automated | config `security.trustedTypes` = `{}` (and `5`) | `createServer` start + `GET /` | server starts; header carries the directive only in a report-only policy; exactly one warning naming `config` |

### Manual-only

_None in this change. The soak-gate evidence (old M1) and the dev-server-under-enforce smoke (old M2) moved to `flip-trusted-types-default-enforce`._

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|

---

## Coverage summary

- Requirements covered:
  - baseline-content-security-policy: 3/3 (Independent Trusted Types mode MODIFIED; config API and env override ADDED).
  - settings-panel: 2/2 ADDED.
- Scenarios by class: edge 8 · frontend 1 · error 1.
- Scenarios by level: L1 9 · L3 1.
- Scenarios by disposition: automated 10 · manual-only 0.
- Moved to `flip-trusted-types-default-enforce`: former F1–F5 (default-enforce E2E, budget pin, header-kind guards, runtime-plugin TT enforce, enforce rehearsal), M1 (soak), M2 (dev under enforce).

## New infra needed

- none. F6 uses `POST /api/restart` as other harness specs do (e.g. `tests/e2e/acp-restart-midturn.spec.ts`).
