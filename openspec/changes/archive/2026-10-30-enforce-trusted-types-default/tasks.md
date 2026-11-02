## 1. Resolver and server

- [x] 1.1 Test (test-plan #E1), see packages/shared/src/__tests__/config-host-gate.test.ts: input the (env × config × CSP) decision table in test-plan E1 · trigger `resolveTrustedTypesMode({env,config,cspMode})` · observable each listed mode; no warning for recognized/unset rows, one naming `env` for `reprot`, one naming `config` for `enforced`/`5`/`{}`, never the raw value
- [x] 1.2 Test (test-plan #E2), see packages/shared/src/__tests__/config.test.ts: input config files with `security.trustedTypes` `"report"`, `5`, absent · trigger `loadConfig()` · observable `result.security?.trustedTypes` is `"report"`, `5`, `undefined`
- [x] 1.3 Test (test-plan #E3), see packages/server/src/__tests__/csp.test.ts (assertTtTopology) and packages/server/src/lib/__tests__/index-html.test.ts: input CSP {report,enforce} × TT {off,report,enforce} · trigger `plan()` headers + `createIndexHtmlSender({trustedTypesMode})` · observable meta equals TT mode; TT enforce has an enforcing policy with the directive (own header under CSP report, appended to strict under CSP enforce); TT report only in report-only policies
- [x] 1.4 Test (test-plan #E4), see packages/server/src/__tests__/csp-report-sink-wiring.test.ts: input `createServer` with config `security.trustedTypes: "enforced"` and env `PI_DASHBOARD_TRUSTED_TYPES=report` · trigger start + `GET /` · observable directive only in a report-only policy, meta `report`, exactly one startup warning naming `config`, none per request
- [x] 1.5 Test (test-plan #X1), see packages/server/src/__tests__/csp-report-sink-wiring.test.ts: input config `security.trustedTypes` = `{}` and `5` · trigger `createServer` start + `GET /` · observable server starts, directive only in a report-only policy, exactly one warning naming `config`
- [x] 1.6 Implement `packages/shared/src/trusted-types-mode.ts` (design D3; default stays `report`, `off` when CSP is off), `security` in `DashboardConfig` + explicit copy in `loadConfig` (D5), remove the old `csp.ts` resolver and re-export, resolve once in `server.ts` and pass the value to `registerCsp` and `createIndexHtmlSender` (required option); update `csp.test.ts` and `index-html.test.ts` callers; update the `csp.ts` module doc

## 2. Config API, dev plugin and Settings

- [x] 2.1 Test (test-plan #E5), see packages/server/src/__tests__/host-gate-config-api.test.ts: input stored {absent, `report`} × sent {`"report"`, `"off"`, `null`}, a sibling `security.otherKey`, a PUT echoing `trustedTypesEnvOverride` · trigger `PUT /api/config` · observable restart flags exactly as in test-plan E5, `null` removes the key, `otherKey` kept, no `trustedTypesEnvOverride` in the file
- [x] 2.2 Test (test-plan #E6), see packages/server/src/__tests__/host-gate-config-api.test.ts: input env `report`, unset, `strict` · trigger `GET /api/config` · observable `trustedTypesEnvOverride` = `"report"`, `null`, `null`
- [x] 2.3 Test (test-plan #E7), see packages/client/src/__tests__/plugin-registry-populated.test.ts: input exported `trustedTypesDevPlugin` with (unset, unset, CSP unset), (unset, unset, CSP off), (unset, config `enforce`) · trigger `transformIndexHtml` on a stub index · observable meta `report`, `off`, `enforce`, equal to `resolveTrustedTypesMode` for the same inputs
- [x] 2.4 Test (test-plan #E8), see packages/client/src/components/settings/__tests__/settings-field-contract.test.tsx and AllowedHostsSection.test.tsx: input stored `report` / nothing stored / `trustedTypesEnvOverride: "report"` · trigger select "Report only" + save, select "Default" + save, untouched save, render with override · observable partial `"report"` + restart notice; `null` + restart notice; no `security` key; disabled control reading "Set by PI_DASHBOARD_TRUSTED_TYPES: Report only"; `CONFIG_FIELD_PAGE.security` = `security`
- [x] 2.5 Implement `config-api.ts` `security` deep merge with `null` delete and value-compared restart flag, `trustedTypesEnvOverride` in `GET /api/config` (`system-routes.ts`) and in the write delete list; export `trustedTypesDevPlugin` and switch it to the shared resolver plus config read; Settings select beside `AllowedHostsSection` with `Config` type, `CONFIG_FIELD_PAGE` and `computeConfigPartial` entries

## 3. E2E

- [x] 3.1 Test (test-plan #F6), see tests/e2e/acp-restart-midturn.spec.ts (restart glue) and tests/e2e/blackhole-settings.spec.ts (settings glue): input default harness with nothing stored · trigger Settings → Security → "Enforce" → Save → `POST /api/restart` → reload · observable meta `enforce` and an enforcing policy carries `require-trusted-types-for 'script'`; then restore Default (`null`) + restart and meta `report`

## 4. Docs and release

- [x] 4.1 Add the CHANGELOG `[Unreleased]` entry: `security.trustedTypes` knob, Settings control, `PI_DASHBOARD_TRUSTED_TYPES` now trimmed and case-insensitive (`OFF` now means off), typo → `report` + warning; default unchanged
- [x] 4.2 Delegate `docs/architecture.md` (§ Trusted Types mode, § Baseline CSP Trusted Types interaction) update to DocScribe
- [x] 4.3 Update `packages/server/src/auth/csp.ts.AGENTS.md` and the AGENTS.md rows for the new shared module and touched files

## 5. Verification

- [x] 5.1 Run the full shared, server and client unit suites
- [x] 5.2 Run `review-code` on the diff before commit
