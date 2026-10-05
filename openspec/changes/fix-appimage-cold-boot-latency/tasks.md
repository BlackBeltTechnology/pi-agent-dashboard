## 1. Native TypeScript loader module (TDD: tests first)

- [x] 1.1 Write a failing L1 test for `.js`→`.ts` resolution in the new `packages/shared/src/__tests__/native-ts-loader.test.ts`. Copy the subprocess-fixture harness from `packages/server/src/lib/__tests__/purify-jiti.test.ts`. Triple: fixture `a.ts` imports `./b.js`, and only `b.ts` exists · run `node --import native-ts-register.mjs a.ts` · exit 0, and stdout prints the value `b.ts` exports (test-plan #E1)
- [x] 1.2 Add an L1 case to `native-ts-loader.test.ts` (harness as in `purify-jiti.test.ts`). Triple: both `b.js` and `b.ts` exist, with different values · import `./b.js` · stdout prints the `b.js` value (test-plan #E2)
- [x] 1.3 Add an L1 case to `native-ts-loader.test.ts` (harness as in `purify-jiti.test.ts`). Triple: `import "./dir"` where `dir/index.ts` exists, plus `import "./c"` where `c.ts` exists · run under the native loader · both modules load, exit 0 (test-plan #E3)
- [x] 1.4 Add an L1 case to `native-ts-loader.test.ts` (harness as in `purify-jiti.test.ts`). Triple: `import "no-such-pkg"`, with a sibling `no-such-pkg.ts` present · run under the native loader · exit ≠ 0, stderr has `ERR_MODULE_NOT_FOUND` naming `no-such-pkg`, and the sibling `.ts` is not loaded (test-plan #E4)
- [x] 1.5 Add an L1 case to `native-ts-loader.test.ts` (harness as in `purify-jiti.test.ts`). Triple: `node_modules/x/index.ts` declares `enum E { A = 1 }` and a class with the parameter property `public v` · import it and print `E.A` and `new K(7).v` · stdout `1 7`, exit 0 (test-plan #E5)
- [x] 1.6 Add an L1 case to `native-ts-loader.test.ts` (harness as in `purify-jiti.test.ts`). Triple: `import data from "./d.json"` with no attribute · run under the native loader · stdout prints `data.k` and there is no `ERR_IMPORT_ATTRIBUTE_MISSING` (test-plan #E6)
- [x] 1.7 Add an L1 case to `native-ts-loader.test.ts` (harness as in `purify-jiti.test.ts`). Triple: a preload deletes `module.stripTypeScriptTypes` · run `node --import <preload> --import native-ts-register.mjs x.ts` · exit ≠ 0, and stderr contains `PI_DASHBOARD_TS_LOADER=jiti` (test-plan #X1)
- [x] 1.8 Add an L1 case to `native-ts-loader.test.ts` (harness as in `purify-jiti.test.ts`). Triple: a fixture `.ts` uses `import x = require("y")` · run under the native loader · exit ≠ 0, stderr names the fixture file, and the process does not hang (test-plan #X2)
- [x] 1.9 Verify 1.1–1.8 fail. Then implement `packages/shared/src/platform/native-ts-register.mjs` and `native-ts-hooks.mjs` per design D3. Port from spike `bd14b0696`: JSON attribute in `resolve`; type-stripping `ExperimentalWarning` suppressed only for that warning; the old-Node guard. Verify 1.1–1.8 pass.

## 2. Loader selection and the shared launcher

- [x] 2.1 Write a failing L1 test in the new `packages/shared/src/__tests__/ts-loader-select.test.ts` (pure-helper harness as in `packages/shared/src/__tests__/node-spawn.test.ts`). Triple: `PI_DASHBOARD_TS_LOADER` ∈ {unset, `native`, `jiti`, `tsx`, `""`} · `selectTsLoader(env)` · unset/`native`/`""`→`native`, `jiti`→`jiti`, and `tsx`→`native` with exactly one warning naming `PI_DASHBOARD_TS_LOADER` and `tsx` (test-plan #E7)
- [x] 2.2 Extend the L1 suite `packages/shared/src/__tests__/node-spawn.test.ts`. Triple: native register URL, raw Windows path `C:\x\…\platform\native-ts-register.mjs`, `/x/other-pkg/native-ts-register.mjs`, and a jiti URL · call `isNativeTsLoader`, `isJitiLoader`, and `isTsxLoader` · native returns true, true, false, false; jiti and tsx return false on the native inputs (test-plan #E12)
- [x] 2.3 Extend the L1 suite `packages/shared/src/__tests__/node-spawn-jiti-contract.test.ts`. Triple: loader = native URL, platform ∈ {win32, linux, darwin}, entries `B:\Dev\cli.ts` and `/x/cli.ts` · `buildNodeImportArgvParts` · on win32 the entry is `file:///B:/Dev/cli.ts`, on POSIX it is raw, and the loader is always `file://` (test-plan #E13)
- [x] 2.4 Extend the L1 suite `packages/shared/src/__tests__/server-launcher.test.ts` (spawn and `_resolveJiti` seams already there). Triple: the process env has no loader var, `opts.env = { PI_DASHBOARD_TS_LOADER: "jiti" }` · `launchDashboardServer` · argv `--import` is the native URL, and `_resolveJiti` is never called (test-plan #E8)
- [x] 2.5 Extend `server-launcher.test.ts` (same seams). Triple: env unset, `cliPath=/x/cli.ts`, `stdio.logFile` set · `launchDashboardServer` · argv is `[--import, <…/platform/native-ts-register.mjs URL>, /x/cli.ts, …]`, and the header line ends `, loader <URL>)` (test-plan #E9)
- [x] 2.6 Extend `server-launcher.test.ts` (same seams). Triple: `PI_DASHBOARD_TS_LOADER=jiti` and `_resolveJiti` → `file:///j/jiti-register.mjs` · `launchDashboardServer` · the argv loader is that URL, and the entry is raw on win32 and on POSIX (test-plan #E10)
- [x] 2.7 Extend `server-launcher.test.ts` (same seams). Triple: `_resolveJiti` → null · `launchDashboardServer`, once with env unset and once with `jiti` · unset resolves without `JitiNotFoundError`; `jiti` throws `JitiNotFoundError` (test-plan #E11)
- [x] 2.8 Verify 2.1–2.7 fail. Then implement:
  - the `.mjs` `selectTsLoader` and the native-register locator by package specifier (D1, D2)
  - `isNativeTsLoader` in `node-spawn.ts` (D8)
  - loader selection plus the header field in `server-launcher.ts`
  - `JitiNotFoundError` only when jiti is selected

  Verify 2.1–2.7 pass.

## 3. CLI bin wrapper

- [x] 3.1 Extend the L1 suite `packages/server/src/__tests__/pi-dashboard-bin-wrapper.test.ts` (spawn-capture seam already there). Triple: env unset · `pi-dashboard status` · the child argv is `--import <native-ts-register URL> …/cli.ts status`, and no jiti lookup runs (test-plan #E14)
- [x] 3.2 Extend `pi-dashboard-bin-wrapper.test.ts` (same seam). Triple: platform ∈ {win32, linux} × loader ∈ {native, jiti} · the wrapper builds the child argv · native+win32 gets a `file://` entry, jiti and linux get a raw entry, and a parity assertion matches `shouldUrlWrapEntry` in all 4 cells (test-plan #E15)
- [x] 3.3 Extend `pi-dashboard-bin-wrapper.test.ts` (same seam). Triple: jiti unresolvable × env ∈ {unset, `jiti`} × argv ∈ {`start`, `--version`} · run the wrapper:
  - unset + `start`: native exec, no "cannot find jiti"
  - `jiti` + `start`: `pi-dashboard: cannot find jiti.` and exit 1
  - `--version`: prints the version and exits 0 in both cases

  (test-plan #E16)
- [x] 3.4 Verify 3.1–3.3 fail. Then implement in `packages/server/bin/pi-dashboard.mjs`: loader selection through the shared `.mjs` helper, and the entry-wrap mirror (D4, D8). Verify they pass.

## 4. Workers, restart, bridge, Electron, Doctor

- [x] 4.1 Extend the L1 suite `packages/server/src/attachments/__tests__/fit-worker-pool.test.ts`. Triple: `process.execArgv = ["--import", <native URL>]` and a `.ts` worker entry · `workerExecArgv` · returns the inherited argv unchanged, and `resolveJiti` is not called (test-plan #E17)
- [x] 4.2 Extend `fit-worker-pool.test.ts`. Triple: `process.execArgv = []` · `workerExecArgv`, once with env unset and once with `jiti` · prepends the native URL or the jiti URL respectively (test-plan #E18)
- [x] 4.3 Extend the L1 suite `packages/server/src/__tests__/restart-helper.test.ts`. Triple: restart params `loader = <jiti URL>`, with `PI_DASHBOARD_TS_LOADER` unset · restart-helper builds the spawn argv · `--import` is the jiti URL and the native URL is absent (test-plan #E19)
- [x] 4.4 Extend the L1 suite `packages/extension/src/__tests__/server-launcher-launch.test.ts`. Triple: `_resolveJiti` → null, env unset · bridge launch path · the native loader is used, with no `logOwned: false` and no jiti-not-found warning (test-plan #E20)
- [x] 4.5 Extend the L1 suite `packages/electron/src/lib/__tests__/launch-source-shared-primitive.test.ts`. Triple: `spawnFromSource(extracted)`, once with env unset and once with `jiti` · capture the spawn · argv[2] is the native URL or the jiti URL respectively, and `nodeBin` is unchanged (test-plan #E21)
- [x] 4.6 Extend the L1 suites `packages/electron/src/lib/__tests__/doctor-launch-test.test.ts` and `packages/shared/src/__tests__/doctor-core.test.ts`. Triple: `resolveJiti` → null × env ∈ {unset, `jiti`} · Doctor launch test and the TS-loader row · unset gives a probe `--import <native URL>`, an OK row, and no "No jiti loader"; `jiti` gives "No jiti loader (install pi)" (test-plan #E30)
- [x] 4.7 Verify 4.1–4.6 fail. Then implement D4 in `fit-worker-pool.ts`, `restart-helper.ts` (unchanged behaviour, comment), the extension `server-launcher.ts` (jiti-only `JitiNotFoundError` mapping), Electron `doctor.ts`, and `doctor-core.ts`. Verify they pass.

## 5. Shell launch helpers and the bundled plugin-load gate

- [x] 5.1 Write a failing L1 test in the new `packages/electron/src/lib/__tests__/start-server-helpers-loader.test.ts`. Copy the repo-lint parity harness from `packages/shared/src/__tests__/jiti-packages-parity.test.ts`. Triple: the text of `start-server.sh`, `.cmd`, and `.ps1` · static parse · all three default to `node_modules/@blackbelt-technology/pi-dashboard-shared/src/platform/native-ts-register.mjs`, switch to jiti only on `PI_DASHBOARD_TS_LOADER=jiti`, and the referenced file is in the shared package `files` (test-plan #E22)
- [x] 5.2 Extend the electron-level suite `scripts/__tests__/assert-bundled-server-plugin-load.test.mjs`. Triple: bundled server layout, env unset · run `assert-bundled-server-plugin-load.mjs` · the spawned argv has `--import <native register URL>`, and the gate passes with at least the expected plugin count (test-plan #E31)
- [x] 5.3 Verify 5.1–5.2 fail. Then update `packages/electron/scripts/server-launch-helpers/start-server.{sh,cmd,ps1}` and `assert-bundled-server-plugin-load.mjs` to use the selected loader. Verify they pass.

## 6. Loader-neutral source gate

- [x] 6.1 Write a failing L1 test in the new `scripts/__tests__/loader-neutral-source.test.mjs`. Copy the fixture and gate harness from `scripts/__tests__/jiti-cjs-transpile-safety.test.mjs`. Triple: fixtures with a bare `require("x")`, an unbound `__dirname`, `module.exports =`, and a `.tsx` file reached by a value import · run the gate · each is reported with file:line, exit ≠ 0 (test-plan #E23)
- [x] 6.2 Add an L1 case to `loader-neutral-source.test.mjs` (same harness). Triple: a `createRequire`-bound `nativeRequire`, a locally declared `__dirname`, `require(` inside a template literal, and an `import type` of a `.tsx` file · run the gate · zero violations (test-plan #E24)
- [x] 6.3 Add an L1 case to `loader-neutral-source.test.mjs` (same harness). Triple: a file reachable only from a plugin `bridge` seed uses an unbound `__dirname` · run the gate on the real seeds · not reported; the same file reached from a `pluginServer` seed is reported (test-plan #E25)
- [x] 6.4 Add an L1 case to `loader-neutral-source.test.mjs` (same harness). Triple: seed discovery is stubbed to return none · run the gate · exit ≠ 0 with an "empty file set" message (test-plan #E26)
- [x] 6.5 Add an L1 case to `loader-neutral-source.test.mjs` (same harness). Triple: a fixture plugin's adjacent `dashboard-plugin.json` gives a different `server` than `package.json#pi-dashboard-plugin` · seed discovery · the `pluginServer` seed is the `dashboard-plugin.json` entry (test-plan #E28)
- [x] 6.6 Extend the L1 suite `scripts/__tests__/jiti-cjs-transpile-safety.test.mjs`. Triple: the repo bin wrapper with the native default · `discoverSeeds()` · `mainTs` contains `packages/server/src/cli.ts`, and the jiti-cjs file set equals the pre-change set (test-plan #E29)
- [x] 6.7 Verify 6.1–6.6 fail. Then implement D5: seed kinds plus both manifest forms in `scripts/lib-jiti-scope.mjs`, and the AST gate script wired into `npm test`. Verify they pass.
- [x] 6.8 Add an L1 repo-tree case to `loader-neutral-source.test.mjs` (same harness). Triple: the repo at HEAD · run the gate · zero violations. Fix `packages/server/src/routes/file-routes.ts:212` to use `createRequire(import.meta.url)`, as `purify.ts` does. Verify it fails before the fix and passes after (test-plan #E27)

## 7. 22.04 AppImage smoke: timing table and budget

- [x] 7.1 Update the electron-level "Smoke the AppImage on Ubuntu 22.04 (glibc floor)" step in `.github/workflows/_electron-build.yml`. Reuse the spike step from `f58e56b4d` as the exemplar for the probe loop and log tail. Triple: extracted x64 AppImage, `ubuntu:22.04`, default loader · boot · the first healthy `/api/health` within 90 s passes, and over 90 s fails the step (test-plan #P1)
- [x] 7.2 In the same step (exemplar: the existing de-noise block at `_electron-build.yml:646-649`), add one shared de-noise filter and a 1 s-resolution marker table, printed before `exit 0`. Triple: a healthy boot · the step completes · the log has rows for electron start, spawn header (naming the native loader), first and last `[plugin-loader]`, `Dashboard server running`, and first health 200, each with elapsed seconds (test-plan #P2)
- [ ] 7.3 Verify the failure path with a throwaway-branch dispatch (skill `validate-ci-workflow-pre-merge`; exemplar `spike/native-ts-loader` runs 37285545559 and 37286703495), forcing `PI_DASHBOARD_TS_LOADER=jiti` in the smoke. Triple: a boot that misses 90 s · the loop expires · the step fails, and the log shows the timing rows reached so far plus the de-noised server log (test-plan #X3)
- [ ] 7.4 Dispatch `CI Electron (on-demand)` on the change branch. Verify linux-x64 is green and the timing table shows the native loader. Write the measured boot time into the workflow comment, next to a cross-reference to the 30 s `ci-electron-on-demand-build` contract (design D6).

## 8. Runtime and cross-platform verification

- [ ] 8.1 Extend the L3 spec `tests/e2e/asciidoc-preview.spec.ts` (docker harness; per its AGENTS row, read the port from `.pi-test-harness.json`). Triple: the harness booted through `pi-dashboard start` with the native default, and an `.adoc` file in the workspace · open the AsciiDoc preview · the preview renders the file's headings, has no `require is not defined`, and the server.log header names the native loader (test-plan #F1)
- [ ] 8.2 Extend the L2 test `qa/tests/02-server-start.ps1` (exemplar: its existing start and health block). Triple: Windows QA VM with the install mapped by `subst B: <install-root>` · start the server from `B:` with env unset · `/api/health` returns 200, the `server.log` header names `native-ts-register.mjs`, and there is no `ERR_UNSUPPORTED_ESM_URL_SCHEME`. Run it on the VM before ship (test-plan #X4)
- [ ] 8.3 Extend the L2 test `qa/tests/02-server-start.sh` (exemplar: its existing start, stop, and log assertions). Triple: server running native · `pi-dashboard stop`, then `PI_DASHBOARD_TS_LOADER=jiti pi-dashboard start` · `/api/health` returns 200, and the second launch's server.log header names `jiti-register.mjs` (test-plan #X5)

## 9. Docs, attribution, closeout

- [x] 9.1 Record the jiti regression attribution (design D7). List `node_modules/.cache/jiti` in the 2026-08-26 AppImage and in the current one, and compare the plugin-graph size. Write the findings into design.md under Context. This is documentation only and does not block other groups.
- [x] 9.2 Add a native-loader launch and attach recipe to the `node-inspect-debugger` skill (`packages/eng-disciplines/.pi/skills/node-inspect-debugger/SKILL.md`). Keep the jiti recipe as the `PI_DASHBOARD_TS_LOADER=jiti` path.
- [x] 9.3 Update the AGENTS.md rows for every touched file, with `See change: fix-appimage-cold-boot-latency`:
  - `server-launcher.ts.AGENTS.md`
  - `packages/shared/src/platform/AGENTS.md`, including the new `.mjs` files
  - `packages/server/bin`
  - `packages/electron/scripts/AGENTS.md`
  - `scripts/AGENTS.md`
  - `fit-worker-pool`
  - `file-routes`

  Delegate any `docs/` prose (the loader section in `docs/architecture.md`, and an FAQ entry for `PI_DASHBOARD_TS_LOADER`) to DocScribe. Verify `node scripts/check-conventions.mjs` passes.
- [ ] 9.4 At archive, update the `jiti-loader` spec Purpose ("jiti is the sole TypeScript loader") and the `packaging` requirement title "(jiti-only)", which deltas cannot change.
- [ ] 9.5 Run `review-code` on the diff, then the full suite (`set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log`). Verify there are no new failures, and that `npm run quality:changed` is clean.
- [ ] 9.6 Delete the throwaway branches `spike/native-ts-loader` and `tmp/bisect-appimage-hang` (local and origin), and remove the `../pi-spike-native-ts` worktree.
