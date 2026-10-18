## 1. RED tests: write first, confirm they fail on the current code

- [x] 1.1 Create `packages/automation-plugin/src/server/__tests__/home-folder-scope.test.ts`, copying harness glue from `packages/automation-plugin/src/server/__tests__/engine-init-after-listen.test.ts` (fake ctx, fake timers, `registerPlugin`). Point `process.env.HOME` at a tmp dir H holding `H/.pi/automation/nightly/automation.yaml` (`schedule`, `cron: "* * * * *"`, `model: "@fast"`), and restore it in `afterEach`. Capture `logger.info` lines and the roles `registerUsage` callback.
- [x] 1.2 Test: global on, session cwd = H · advance past the init delay · arm log reads `armed 1 automation(s) across 1 scope(s)` and roles usage has one entry, `global:nightly` (test-plan #E1)
- [x] 1.3 Test: as E1 · advance the fake clock to the next minute boundary · `spawnSession` called exactly once for that occurrence (test-plan #E2)
- [x] 1.4 Test: global on, session cwd = `H + "/"` · advance past the init delay · arm log reads `armed 1 automation(s) across 1 scope(s)`, no `folder:` usage entry (test-plan #E3)
- [x] 1.5 Test: global on, no session at start; after the first `spawnSession` call, `listAll()` also returns `{ cwd: H }` · fire, emit one `onEvent` activity event, advance past `RESCAN_DEBOUNCE_MS` (15 s), then advance to the next occurrence · arm log after the rescan still reads `armed 1 automation(s) across 1 scope(s)` and `spawnSession` totals 2 calls, not 3 (test-plan #E4)
- [x] 1.6 Create `packages/automation-plugin/src/__tests__/routes-list-home.test.ts`, copying harness glue from `packages/automation-plugin/src/__tests__/routes-stop.test.ts` (`mountAutomationRoutes(Fastify(), hooks)` + `app.inject`), with `process.env.HOME` = tmp H as in 1.1. Test: no `scanGlobalScope` hook · `GET /api/plugins/automation/list?cwd=<H>` · exactly one `nightly` entry, `scope: "global"`, and no `scope: "folder"` entry (test-plan #E7)
- [x] 1.7 Run the new tests and confirm E1, E2, E3, E4 and E7 FAIL on the unchanged code. If any of them passes, stop and apply `systematic-debugging` before touching source: the root cause in proposal.md would be wrong.

## 2. Guard tests: must pass before and after the fix

- [x] 2.1 In `home-folder-scope.test.ts` (harness from 1.1). Test: `scanGlobalScope: false`, session cwd = H · advance past the init delay · arm log reads `armed 1 automation(s) across 1 scope(s)` and roles usage has one entry, `folder:nightly` (test-plan #E5)
- [x] 2.2 In `home-folder-scope.test.ts`. Test: global on, plus `H/proj/.pi/automation/build/automation.yaml`, session cwd = `H/proj` · advance past the init delay · arm log reads `armed 2 automation(s) across 2 scope(s)`; usage contains `global:nightly` and `folder:build` (test-plan #E6)
- [x] 2.3 In `routes-list-home.test.ts` (harness from 1.6). Test: hook `scanGlobalScope: () => false` · `GET /list?cwd=<H>` · a `nightly` entry with `scope: "folder"` is present (test-plan #E8)
- [x] 2.4 In `routes-list-home.test.ts`. Test: tmp repo R outside H with `R/.pi/automation/build/automation.yaml` · `GET /list?cwd=<R>` · `build` (`folder`) and `nightly` (`global`), each exactly once (test-plan #E9)
- [x] 2.5 In `packages/automation-plugin/src/__tests__/folder-scope-contributions.test.ts` (extend the existing describe). Test: `collectFolderScopeBases([{ key: "automation.folderscope.x", value: { base: H } }], { warn, homeDir: H })` · call · returns `[]` (test-plan #E10)

## 3. Fix arming: `listScopes()`

- [x] 3.1 In `packages/automation-plugin/src/server/index.ts` `listScopes()`: while `cfg.scanGlobal` is true, skip any folder base whose `path.resolve` equals `path.resolve(homeDir)`. `homeDir` is the existing `os.homedir()` binding (`:195`). Leave `folderScopeBases()` and `collectFolderScopeBases` unchanged.
- [x] 3.2 Run section 1's plugin-harness tests (E1–E4) and section 2's guards (E5, E6): all green.

## 4. Fix the board list: `/list`

- [x] 4.1 In `packages/automation-plugin/src/server/routes.ts`, add an optional `scanGlobalScope?: () => boolean` to `AutomationRouteHooks` (absent = `true`). In `/list`, set `scanFolder` to `!!q.cwd && !(globalOn && path.resolve(q.cwd) === path.resolve(os.homedir()))`.
- [x] 4.2 In `index.ts` `mountAutomationRoutes(...)`, provide `scanGlobalScope: () => ctx.getPluginConfig<AutomationPluginConfig>()?.scanGlobalScope !== false`. Do not use `pluginConfig()`, which is local to `initEngine`.
- [x] 4.3 Run E7, E8, E9: all green.

## 5. Close out

- [x] 5.1 Run the full automation-plugin test suite (`set -o pipefail; npx vitest run packages/automation-plugin 2>&1 | tee /tmp/pi-test.log`) and grep the summary; no new failures.
- [x] 5.2 Update the DOX rows: `index.ts`, `routes.ts` in `packages/automation-plugin/src/server/AGENTS.md`, and the two new test files in their directory `AGENTS.md`, each with `See change: fix-home-folder-scope-double-arm`.
- [x] 5.3 Add a CHANGELOG `## [Unreleased]` Fixed line: global automations no longer run twice per occurrence while a session (including the automation's own run) is open in the home directory.
- [x] 5.4 Run `review-code` on the diff before committing.
