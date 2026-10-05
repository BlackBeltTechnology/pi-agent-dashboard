# Test Plan — fix-appimage-cold-boot-latency

Stage: design   Generated: 2026-10-05

Hard gate resolved (2 clarifications answered):
- **P1 threshold.** The 22.04 smoke hard-fails at 90 s. The timing table is informational.
- **Windows.** Native-loader verification on Windows is L2. *(Ship-time decision, 2026-10-05: no
  Windows VM on the shipping host; the win32-x64 CI Electron leg's native boot (plugin-load gate,
  `C:` path) is accepted as the pre-ship Windows gate, and the `subst B:` VM run of
  `qa/tests/02-server-start.ps1` is a manual follow-up — X4 is `manual-only`.)* Extend
  `qa/tests/02-server-start.ps1` with a native header check, health, and a `subst B:` launch, and
  run it on the QA VM (manual follow-up; see above).

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | native-ts-loader: register module (resolve) | EP | L1 | automated | fixture dir with `a.ts` importing `./b.js`; only `b.ts` exists | `node --import native-ts-register.mjs a.ts` (subprocess) | exit 0; stdout prints the value exported by `b.ts` |
| E2 | native-ts-loader: register module (resolve) | EP | L1 | automated | fixture with both `b.js` and `b.ts` (different exported values) | import `./b.js` | stdout prints the `b.js` value, not `b.ts` |
| E3 | native-ts-loader: register module (resolve) | EP | L1 | automated | `import "./dir"` where `dir/index.ts` exists; plus `import "./c"` where `c.ts` exists | run the fixture under the native loader | both modules load; exit 0 |
| E4 | native-ts-loader: bare specifier not rewritten | EP | L1 | automated | `import "no-such-pkg"` and a sibling `no-such-pkg.ts` file | run the fixture under the native loader | exit ≠ 0; stderr contains `ERR_MODULE_NOT_FOUND` naming `no-such-pkg`; the sibling `.ts` is NOT loaded |
| E5 | native-ts-loader: transform mode under node_modules | EP | L1 | automated | `node_modules/x/index.ts` declaring `enum E { A = 1 }` and `class K { constructor(public v: number) {} }` | import it and print `E.A` and `new K(7).v` | stdout `1 7`; exit 0 |
| E6 | native-ts-loader: JSON attribute | EP | L1 | automated | `import data from "./d.json"` with no `with { type: "json" }` | run the fixture under the native loader | stdout prints `data.k`; no `ERR_IMPORT_ATTRIBUTE_MISSING` |
| E7 | server-launch: TypeScript loader selection (decision table) | decision-table | L1 | automated | `PI_DASHBOARD_TS_LOADER` ∈ {unset, `native`, `jiti`, `tsx`, `""`} | `selectTsLoader(env)` | unset/`native`/`""`→`native`; `jiti`→`jiti`; `tsx`→`native` plus exactly one warning that names `PI_DASHBOARD_TS_LOADER` and `tsx` |
| E8 | server-launch: selection reads the launching process env | decision-table | L1 | automated | `process.env` with no loader var; `opts.env = { PI_DASHBOARD_TS_LOADER: "jiti" }` | `launchDashboardServer(opts)` with the injected spawn seam | argv `--import` holds the native register URL; `_resolveJiti` is never called |
| E9 | server-launch: default launch argv + log header | EP | L1 | automated | env unset, `cliPath=/x/cli.ts`, `stdio.logFile` set | `launchDashboardServer` | argv `[--import, <…/platform/native-ts-register.mjs URL>, /x/cli.ts, …]`; the header line ends `, loader <that URL>)` |
| E10 | server-launch: jiti opt-in unchanged | EP | L1 | automated | `PI_DASHBOARD_TS_LOADER=jiti`, `_resolveJiti` → `file:///j/jiti-register.mjs` | `launchDashboardServer` | argv loader `file:///j/jiti-register.mjs`; entry raw on win32 and POSIX (same as pre-change) |
| E11 | server-launch: native launch does not require jiti | EP | L1 | automated | env unset, `_resolveJiti` → null | `launchDashboardServer` | resolves without throwing `JitiNotFoundError`; with `PI_DASHBOARD_TS_LOADER=jiti` the same input throws `JitiNotFoundError` |
| E12 | dashboard-server: `isNativeTsLoader` identity | EP | L1 | automated | `file:///…/pi-dashboard-shared/src/platform/native-ts-register.mjs`; `C:\x\…\platform\native-ts-register.mjs`; `/x/other-pkg/native-ts-register.mjs`; a jiti URL | `isNativeTsLoader` / `isJitiLoader` / `isTsxLoader` | true, true, false, false for native; jiti/tsx false on the native inputs |
| E13 | server-launch: entry-wrap rule for native | decision-table | L1 | automated | loader = native URL; platform ∈ {win32, linux, darwin}; entry `B:\Dev\cli.ts` / `/x/cli.ts` | `buildNodeImportArgvParts` | entry raw on every platform (D8 revised); loader always `file://` |
| E14 | dashboard-server: bin wrapper default loader | EP | L1 | automated | wrapper run with env unset, the spawn captured (existing wrapper-test seam) | `pi-dashboard status` | child argv `--import <native-ts-register URL> …/cli.ts status`; no jiti lookup performed |
| E15 | dashboard-server: bin wrapper mirrors entry-wrap | decision-table | L1 | automated | `process.platform` ∈ {win32, linux} × loader ∈ {native, jiti} | wrapper builds the child argv | every cell → raw entry (D8 revised). A parity assertion compares the result with `shouldUrlWrapEntry` for all 4 cells |
| E16 | electron-launch-source: CLI wrapper fails loud only for the selected loader | decision-table | L1 | automated | jiti unresolvable × env ∈ {unset, `jiti`} × argv ∈ {`start`, `--version`} | wrapper run | unset+start → native exec, no "cannot find jiti"; jiti+start → stderr `pi-dashboard: cannot find jiti.`, exit 1; `--version` → prints version, exit 0, in both cases |
| E17 | server-launch: worker threads keep the loader | EP | L1 | automated | `process.execArgv = ["--import", <native URL>]`; `.ts` worker entry | `workerExecArgv` (fit-worker-pool) | returns the inherited argv unchanged; `resolveJiti` not called |
| E18 | server-launch: worker without any TS loader | EP | L1 | automated | `process.execArgv = []`, env unset | `workerExecArgv` | prepends `--import <native URL>`; with `PI_DASHBOARD_TS_LOADER=jiti` prepends the jiti URL |
| E19 | server-launch: restart keeps the running loader | state-transition | L1 | automated | restart params `loader = <jiti URL>`; `PI_DASHBOARD_TS_LOADER` unset in env | restart-helper builds the spawn argv | argv `--import` is the jiti URL; the native URL is absent |
| E20 | server-launch: bridge auto-start under native | EP | L1 | automated | extension launcher with `_resolveJiti` → null, env unset | bridge `launchDashboardServer` path (extension `server-launcher.ts`) | launch proceeds with the native loader; no `logOwned: false` / jiti-not-found warning emitted |
| E21 | server-launch: Electron spawn argv carries the selected loader | EP | L1 | automated | `spawnFromSource(extracted source)` with env unset, then with `PI_DASHBOARD_TS_LOADER=jiti` | spawn captured | argv[2] = native register URL / jiti URL respectively; `nodeBin` from `pickNodeForServer` unchanged |
| E22 | server-launch: shell helpers' fixed native path | EP | L1 | automated | `start-server.sh`, `start-server.cmd`, `start-server.ps1` text, plus the bundle layout | static parse | all three reference `node_modules/@blackbelt-technology/pi-dashboard-shared/src/platform/native-ts-register.mjs` by default and switch to the jiti path only on `PI_DASHBOARD_TS_LOADER=jiti`; the referenced file exists in the shared package's `files` |
| E23 | native-ts-loader: loader-neutral gate (violations) | decision-table | L1 | automated | fixtures: bare `require("x")`; unbound `__dirname`; `module.exports =`; `.tsx` reached by a value import | run the gate on the fixture set | each reported with file:line; exit ≠ 0 |
| E24 | native-ts-loader: loader-neutral gate (allowed) | decision-table | L1 | automated | fixtures: `const nativeRequire = createRequire(import.meta.url)`; `const __dirname = dirname(fileURLToPath(import.meta.url))`; `"require("` inside a template literal; `import type` of a `.tsx` file | run the gate | zero violations |
| E25 | native-ts-loader: gate scope excludes bridge seeds | EP | L1 | automated | a file reachable only from a plugin `bridge` seed using unbound `__dirname` | run the gate on the real repo seeds | not reported; the same file reached from a `pluginServer` seed IS reported |
| E26 | native-ts-loader: gate fail-closed | BVA | L1 | automated | empty file set (seed discovery stubbed to return none) | run the gate | exit ≠ 0 with an "empty file set" message |
| E27 | native-ts-loader: gate on the current tree | EP | L1 | automated | the repo at HEAD after the `file-routes.ts` fix | run the gate | zero violations; `file-routes.ts` no longer has a bare `require` |
| E28 | native-ts-loader: seeds from both manifest forms | EP | L1 | automated | fixture plugin with an adjacent `dashboard-plugin.json` whose `server` differs from `package.json#pi-dashboard-plugin.server` | seed discovery | the `pluginServer` seed is the `dashboard-plugin.json` entry (runtime precedence) |
| E29 | jiti-cjs-transpile-safety: seed 2 survives | EP | L1 | automated | the repo bin wrapper after the change (native default) | `discoverSeeds()` | `mainTs` contains `packages/server/src/cli.ts`; the jiti-cjs file set equals the pre-change set |
| E30 | dashboard-server: Doctor launch test uses the selected loader | decision-table | L1 | automated | `resolveJiti` → null × env ∈ {unset, `jiti`} | Electron `doctor.ts` launch test + `doctor-core` TS-loader row | unset → probe cmd `--import <native URL>`, row OK, no "No jiti loader"; jiti → "No jiti loader (install pi)" as today |
| E31 | server-launch: plugin-load build gate boots the selected loader | EP | electron | automated | bundled server layout, env unset | `assert-bundled-server-plugin-load.mjs` | spawned argv `--import <native register URL>`; gate passes with ≥ the expected plugin count |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | electron-build-pipeline: AppImage boots within budget | threshold | electron | automated | extracted x64 AppImage, `ubuntu:22.04` container, xvfb, default (native) loader | first healthy `/api/health` ≤ 90 s → pass; > 90 s → step fails | one boot per `CI Electron (on-demand)` run |
| P2 | electron-build-pipeline: timing table on success | threshold | electron | automated | same boot as P1, healthy | the step log contains a table with rows for electron start, spawn header (naming the native loader), first `[plugin-loader]`, last `[plugin-loader]`, `Dashboard server running`, first health 200, each with elapsed seconds, printed before the step's `exit 0` | same run |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | native-ts-loader: loader-neutral source (runtime) | state-transition | L3 | automated | docker harness (boots via `pi-dashboard start`, native default); an `.adoc` file in the workspace | open the AsciiDoc preview | preview renders headings from the file (no `require is not defined` error); server.log header names the native loader |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | native-ts-loader: old Node guard | fault-injection (abort) | L1 | automated | a preload that deletes `module.stripTypeScriptTypes` before the register module runs | `node --import <preload> --import native-ts-register.mjs x.ts` | exit ≠ 0; stderr contains `PI_DASHBOARD_TS_LOADER=jiti` |
| X2 | native-ts-loader: unsupported syntax surfaces | fault-injection (abort) | L1 | automated | fixture `.ts` using `import x = require("y")` | run under the native loader | exit ≠ 0; stderr names the fixture file (no silent hang) |
| X3 | electron-build-pipeline: slow boot is attributable | fault-injection (delay) | electron | automated | boot that never reaches health within 90 s (exercised by the throwaway-branch dispatch with a forced `PI_DASHBOARD_TS_LOADER=jiti`, per skill `validate-ci-workflow-pre-merge`) | the 90 s loop expires | step fails; log contains the timing rows reached so far and the de-noised server log |
| X4 | server-launch: Windows native launch incl. `B:` drive | fault-injection (environment) | L2 | manual-only | Windows QA VM; dashboard install mapped with `subst B: <install-root>` | `qa/tests/02-server-start.ps1` starts the server from `B:` with env unset | `/api/health` 200; `server.log` header names `native-ts-register.mjs`; no `ERR_UNSUPPORTED_ESM_URL_SCHEME` |
| X5 | server-launch: jiti rollback on a fresh launch | state-transition | L2 | automated | Linux qa VM, server running native | `pi-dashboard stop`, then `PI_DASHBOARD_TS_LOADER=jiti pi-dashboard start` | `/api/health` 200; the server.log header for the second launch names `jiti-register.mjs` |

---

## Coverage summary

- Requirements covered: 14/14 (native-ts-loader ×2, server-launch ADDED + 2 MODIFIED, jiti-loader, dashboard-server ×3, packaging, electron-launch-source ×2, electron-shell, bridge-extension, jiti-cjs-transpile-safety, electron-build-pipeline). packaging, electron-shell, and jiti-loader are covered through E14–E16, E21, and E10/E16.
- Scenarios by class: edge 31 · perf 2 · frontend 1 · error 5
- Scenarios by level: L1 32 · L2 2 · L3 1 · electron 4
- Scenarios by disposition: automated 38 · manual-only 1 (X4, ship-time decision)

## New infra needed

- None. The subprocess-fixture pattern exists (`packages/server/src/lib/__tests__/purify-jiti.test.ts`). The `subst B:` step is a new block inside the existing `qa/tests/02-server-start.ps1`.
