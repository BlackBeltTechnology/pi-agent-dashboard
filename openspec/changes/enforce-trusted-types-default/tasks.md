## 1. Pre-flip soak gate (evidence before any code change)

- [ ] 1.1 Confirm `add-trusted-types-shadow-enforce` is released; record the release version, the live `PI_DASHBOARD_CSP` resolution and the number of deployments contributing evidence
- [ ] 1.2 Opening canary: run the steps of `add-trusted-types-shadow-enforce` test-plan F2 against the released instance and record `cspReports.ttShadow` (read on the host as a loopback, disclosure-permitted operator) showing `would-alter-html` ≥ 1 and `would-block-script-url` ≥ 1; then `POST /api/csp-reports/reset`, wait ≥ 5 s, restart gracefully, record the reset time as window start
- [ ] 1.3 Enforce rehearsal (test-plan #F5), see tests/e2e/trusted-types-enforce.spec.ts: input `forceTtMode(page,"enforce")` over the spec's routes plus `/settings/security` · trigger load each and open the Trusted Types control · observable 0 page errors, 0 TT violations, control visible and operable; also run tests/e2e/trusted-types-visual.spec.ts green
- [ ] 1.4 Soak window evidence (test-plan: manual-only, #M1): after ≥ 14 consecutive days spanning ≥ 1 release, record `cspReports` (`since`, `dropped`, `require-trusted-types-for` counts, `ttShadow` with its `since`), verify `ttShadow.since` ≤ window start and every gate counter is zero, then run the closing canary and record both outcomes seen; on any non-zero, capture `GET /api/csp-violations` rows and stop (fix change, or a doubt-reviewed amendment for `would-*` only)

## 2. Resolver and server

- [ ] 2.1 Test (test-plan #E1), see packages/shared/src/__tests__/config-host-gate.test.ts: input the (env × config × CSP) decision table in test-plan E1 · trigger `resolveTrustedTypesMode({env,config,cspMode})` · observable each listed mode; no warning for recognized/unset rows, one naming `env` for `reprot`, one naming `config` for `enforced`/`5`/`{}`, never the raw value
- [ ] 2.2 Test (test-plan #E2), see packages/shared/src/__tests__/config.test.ts: input config files with `security.trustedTypes` `"report"`, `5`, absent · trigger `loadConfig()` · observable `result.security?.trustedTypes` is `"report"`, `5`, `undefined`
- [ ] 2.3 Test (test-plan #E3), see packages/server/src/__tests__/csp.test.ts (assertTtTopology) and packages/server/src/lib/__tests__/index-html.test.ts: input CSP {report,enforce} × TT {off,report,enforce} · trigger `plan()` headers + `createIndexHtmlSender({trustedTypesMode})` · observable meta equals TT mode; TT enforce has an enforcing policy with the directive (own header under CSP report, appended to strict under CSP enforce); TT report only in report-only policies
- [ ] 2.4 Test (test-plan #E4), see packages/server/src/__tests__/csp-report-sink-wiring.test.ts: input `createServer` with config `security.trustedTypes: "enforced"` and env `PI_DASHBOARD_TRUSTED_TYPES=report` · trigger start + `GET /` · observable directive only in a report-only policy, meta `report`, exactly one startup warning naming `config`, none per request
- [ ] 2.5 Test (test-plan #X1), see packages/server/src/__tests__/csp-report-sink-wiring.test.ts: input config `security.trustedTypes` = `{}` and `5` · trigger `createServer` start + `GET /` · observable server starts, directive only in a report-only policy, exactly one warning naming `config`
- [ ] 2.6 Implement `packages/shared/src/trusted-types-mode.ts` (design D3), `security` in `DashboardConfig` + explicit copy in `loadConfig` (D5), remove the old `csp.ts` resolver and re-export, resolve once in `server.ts` and pass the value to `registerCsp` and `createIndexHtmlSender` (required option); update `csp.test.ts` (report-default, WE12-14) and `index-html.test.ts` callers; update the `csp.ts` module doc

## 3. Config API, dev plugin and Settings

- [ ] 3.1 Test (test-plan #E5), see packages/server/src/__tests__/host-gate-config-api.test.ts: input stored {absent, `report`} × sent {`"report"`, `"off"`, `null`}, a sibling `security.otherKey`, a PUT echoing `trustedTypesEnvOverride` · trigger `PUT /api/config` · observable restart flags exactly as in test-plan E5, `null` removes the key, `otherKey` kept, no `trustedTypesEnvOverride` in the file
- [ ] 3.2 Test (test-plan #E6), see packages/server/src/__tests__/host-gate-config-api.test.ts: input env `report`, unset, `strict` · trigger `GET /api/config` · observable `trustedTypesEnvOverride` = `"report"`, `null`, `null`
- [ ] 3.3 Test (test-plan #E7), see packages/client/src/__tests__/plugin-registry-populated.test.ts: input exported `trustedTypesDevPlugin` with (unset, unset, CSP unset), (unset, unset, CSP off), (unset, config `report`) · trigger `transformIndexHtml` on a stub index · observable meta `enforce`, `off`, `report`, equal to `resolveTrustedTypesMode` for the same inputs
- [ ] 3.4 Test (test-plan #E8), see packages/client/src/components/settings/__tests__/settings-field-contract.test.tsx and AllowedHostsSection.test.tsx: input stored `report` / nothing stored / `trustedTypesEnvOverride: "report"` · trigger select "Report only" + save, select "Default" + save, untouched save, render with override · observable partial `"report"` + restart notice; `null` + restart notice; no `security` key; disabled control reading "Set by PI_DASHBOARD_TRUSTED_TYPES: Report only"; `CONFIG_FIELD_PAGE.security` = `security`
- [ ] 3.5 Implement `config-api.ts` `security` deep merge with `null` delete and value-compared restart flag, `trustedTypesEnvOverride` in `GET /api/config` (`system-routes.ts`) and in the write delete list; export `trustedTypesDevPlugin` and switch it to the shared resolver plus config read; Settings select beside `AllowedHostsSection` with `Config` type, `CONFIG_FIELD_PAGE` and `computeConfigPartial` entries

## 4. E2E alignment and new coverage

- [ ] 4.1 Test (test-plan #F1), see tests/e2e/csp.spec.ts: input docker harness with `PI_DASHBOARD_TRUSTED_TYPES` unset and no `forceTtMode` · trigger load `/` · observable meta `enforce`, an enforcing policy containing `require-trusted-types-for 'script'` (shape per harness CSP mode), app renders with 0 page errors (new `tests/e2e/trusted-types-default.spec.ts`)
- [ ] 4.2 Test (test-plan #F2), see tests/e2e/trusted-types-budget.spec.ts and tests/e2e/csp-strict-report.spec.ts: input default (enforce) harness, both pinned with `forceTtMode(page,"report")` + `TT_LAUNCH_ARGS` · trigger run both specs · observable budget routes 0 violations and `defaultHits` within budget, control step exactly 1 violation, WF4 passes; update the budget spec header comment
- [ ] 4.3 Test (test-plan #F3), see tests/e2e/csp.spec.ts: input default (enforce) harness; `csp.spec.ts`, `runtime-plugin-csp-enforce.spec.ts`, `runtime-plugin-remote-and-paired.spec.ts` with kind-based guards (design D7) after a `grep -l content-security-policy tests/e2e/*.spec.ts` sweep · trigger run them and compare the skip list with a pre-flip run · observable all pass and the skipped set is unchanged
- [ ] 4.4 Test (test-plan #F4), see tests/e2e/runtime-plugin-csp-enforce.spec.ts: input `PI_DASHBOARD_CSP=enforce`, TT enforce, trusted runtime plugin claim · trigger render the claim · observable claim renders with styles, 0 CSP and 0 TT violations
- [ ] 4.5 Test (test-plan #F6), see tests/e2e/acp-restart-midturn.spec.ts (restart glue) and tests/e2e/blackhole-settings.spec.ts (settings glue): input default harness with nothing stored · trigger Settings → Security → "Report only" → Save → `POST /api/restart` → reload · observable meta `report` and no enforcing policy carries the directive; then restore Default (`null`) and restart
- [ ] 4.6 Implement the default flip in the shared resolver default and update the `docker/compose.test.yml:192-194` and `docker/test-up.sh:249-253` comments (empty = enforce unless CSP off)

## 5. Docs and release

- [ ] 5.1 Add the CHANGELOG `[Unreleased]` BREAKING (security default) entry: new default, `security.trustedTypes` knob and Settings control, rollback via Settings / `~/.pi/dashboard/config.json` / env, case-insensitive parsing change (`OFF`), typo → `report` + warning, `eval`/`new Function`/string-timer known limit
- [ ] 5.2 Delegate `docs/architecture.md` (§ Trusted Types mode, § Baseline CSP Trusted Types interaction) and `docs/faq.md:4590` updates to DocScribe
- [ ] 5.3 Update `packages/server/src/auth/csp.ts.AGENTS.md`, `docker/test-up.sh.AGENTS.md`, and the AGENTS.md rows for the new shared module and touched files
- [ ] 5.4 If `enforce-strict-csp-default` is still active, update its proposal sentence "unset TT still follows `report`" to the new default; if it has landed, run 6.2 with both modes unset

## 6. Post-flip verification

- [ ] 6.1 Run the full shared, server and client unit suites
- [ ] 6.2 Run the Playwright E2E against the docker harness with `PI_DASHBOARD_TRUSTED_TYPES` unset (and `PI_DASHBOARD_CSP` unset if the sibling flip landed)
- [ ] 6.3 Dev server under enforce (test-plan: manual-only, #M2): `npm run dev` with TT resolved `enforce`, edit a client file (HMR) and force a compile error; confirm HMR applies, the Vite error overlay renders, and no TT errors appear in the console
- [ ] 6.4 Run `review-code` on the diff before commit
