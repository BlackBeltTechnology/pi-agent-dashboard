# Test Plan — slim-windows-install-file-count

Stage: design   Generated: 2026-10-27

Gate answers (ask_user, 2026-10-27):
- Q1: a prune filesystem error fails the build (exit≠0, path logged).
- Q2: the NSIS upgrade from the previous release runs as an automated CI step on win32-x64.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | prune helper — declaration variants | EP | L1 | automated | temp tree `node_modules/foo/{index.js,index.d.mts,index.d.cts,index.d.ts}` | `pruneBundle(dir,…)` | only `index.js` remains |
| E2 | prune helper — package-root guard | BVA (depth 0 / nested) | L1 | automated | `node_modules/test/package.json`, `node_modules/a/node_modules/tests/package.json`, `node_modules/b/test/x.js` (no package.json) | `pruneBundle` | both package dirs exist; `node_modules/b/test` removed |
| E3 | prune helper — licence notice keep | EP | L1 | automated | `node_modules/@napi-rs/keyring-linux-x64-gnu/{LICENSE,LICENSE.third-party.md}` | `pruneBundle` | `LICENSE.third-party.md` exists; `LICENSE` removed |
| E4 | prune helper — first-party rule set | decision-table (scope × file kind) | L1 | automated | `node_modules/@blackbelt-technology/pi-dashboard-extension/{src/AGENTS.md,src/bridge.ts.AGENTS.md,src/bridge.ts,README.md,.pi/skills/browser/{SKILL.md,LICENSE,UPSTREAM.md,AGENTS.md},commands/x.md,agents/y.md,src/__tests__/a.test.ts}` | `pruneBundle` | removed: `src/AGENTS.md`, `src/bridge.ts.AGENTS.md`, `src/__tests__/`; every other listed file exists |
| E5 | prune helper — resources/plugins scope | EP | L1 | automated | `resources/plugins/kb/{AGENTS.md,src/x.ts.AGENTS.md,src/x.ts,.pi/skills/s/SKILL.md}` | `pruneBundle` | sidecars removed; `src/x.ts` and `SKILL.md` exist |
| E6 | prune helper — served client untouched | EP | L1 | automated | `node_modules/@blackbelt-technology/pi-dashboard-web/dist/{a.js.map,LICENSE.txt}` + `packages/dist/client/b.js.map` | `pruneBundle` | all three files exist |
| E7 | prune helper — runtime TS source kept | EP | L1 | automated | `node_modules/@blackbelt-technology/pi-dashboard-server/src/{cli.ts,types.d.ts}` | `pruneBundle` | `cli.ts` exists (first-party rule set does not touch `.d.ts`; `types.d.ts` exists) |
| E8 | ships once under node_modules | state (post-build layout) | electron | automated | CI-native bundle after `bundle-server.mjs` (full) | built-bundle layout assert | `resources/server/packages/` children == `["dist"]`; `node_modules/@blackbelt-technology/pi-dashboard-server/src/cli.ts` exists; `package.json` has no `workspaces` key; exit 0 |
| E9 | ships once — Docker cross-build | state | L1 | automated | `docker-make.sh` text (extends `docker-make-windows-bundle.test.ts`) | static assertion | script deletes `packages/<dir>` except `dist`, strips `workspaces`, and calls `prune-bundle.mjs` after materialization |
| E10 | release-lock ordering | state-transition | L1 | automated | `bundle-server.mjs` source order | static order assertion | `auditInstalledTree` call precedes the materialization loop, which precedes `packages/<dir>` deletion, which precedes `pruneBundle`, which precedes the keyring GO/NO-GO |
| E11 | repointed readers — extension path | EP | L1 | automated | `extensionPathFor(BUNDLED_RUNTIME_ID, dir, "/R")` | call | returns `/R/server/node_modules/@blackbelt-technology/pi-dashboard-extension` (update `launch-source.test.ts:463-465` expectation) |
| E12 | repointed readers — findBundledExtension | EP | L1 | automated | `resourcesPath=/R` with only the node_modules extension dir + `package.json` | `findBundledExtension()` | returns the node_modules path; returns null when only `/R/server/packages/extension` exists |
| E13 | repointed readers — doctor | EP | L1 | automated | `resourcesPath=/R` fixture with node_modules server `package.json` version `9.9.9` | doctor bundled checks | reports cli path under node_modules and version `9.9.9` |
| E14 | repointed readers — bridge server fallback | EP | L1 | automated | extension dir at `<R>/node_modules/@blackbelt-technology/pi-dashboard-extension`, `require.resolve` stubbed to throw | `server-launcher` cli resolution | resolves `<R>/node_modules/@blackbelt-technology/pi-dashboard-server/src/cli.ts` |
| E15 | repointed readers — launch helpers | EP | L1 | automated | `start-server.{sh,ps1,cmd}` text | static assertion | each names `node_modules/@blackbelt-technology/pi-dashboard-server/src/cli.ts` (or `\` form); none names `packages/server/src/cli.ts` |
| E16 | no leftover reader | EP | ci | automated | repo grep over `packages/electron/{src,scripts}`, `packages/extension/src`, `tests/e2e-electron` for `server/packages/(server\|extension\|shared)` and `"server", "packages"` | lint test | zero hits outside `__tests__` fixtures and dev/localLink branches |
| E17 | budget gate — within budget | BVA (count = budget) | L1 | automated | temp `resources/` with N regular files, budget N | run script | exit 0; stdout contains `N` and budget |
| E18 | budget gate — over budget | BVA (budget+1) | L1 | automated | N+1 files across 25 dirs, budget N | run script | exit 1; stdout lists exactly 20 directories sorted by count desc |
| E19 | budget gate — no pin | EP | L1 | automated | unknown platform/arch | run script | exit 0; prints count and `no budget pinned` |
| E20 | budget gate — symlinks not followed | EP | L1 | automated | 3 regular files + 2 symlinks (one to a dir of 10 files) | run script | count == 3 |
| E21 | stale registration cleanup on upgrade | state-transition | L1 | automated | settings `packages: ["/R/server/packages/extension"]` (path absent, `/R` contains `PI Dashboard`) | `registerBridgeExtension("/R/server/node_modules/@blackbelt-technology/pi-dashboard-extension")` | `packages` == `[new path]` (extends `packages/shared/src/__tests__/bridge-register.test.ts`) |
| E22 | rollback dedup | state-transition | L1 | automated | settings with existing node_modules extension path (exists, same `package.json#name`) | register `/R/server/packages/extension` | `packages` == `[packages/extension path]` |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | file-count goal | threshold | electron | automated | win32-x64 CI bundle, change branch vs develop baseline from same workflow | packaged `resources/` regular-file count ≤ 75% of baseline | one CI run each |
| P2 | Windows install timing reported | measurement (informational) | electron | automated | win32-x64 NSIS smoke, `Setup.exe /S` | job summary contains `install_seconds`, runner image, `installed_file_count` (no threshold, never fails) | one install per run |

### Frontend-quirk

_none: the change has no rendered UI._

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | prune failure fails the build | fault-injection (abort) | L1 | automated | `rmSync` stubbed to throw `EPERM` on one matched path | `pruneBundle` | throws; error message contains the path; the CLI wrapper exits ≠0 |
| X2 | built-bundle boot on canonical entry | fault-injection (missing file) | electron | automated | packaged bundle with `packages/server` removed | `assert-bundled-server-plugin-load.mjs` (booting the node_modules entry) | all bundled server plugins report `Loaded plugin`; zero `Failed to load plugin`; exit 0 |
| X3 | third-party `tests` dir not a runtime input | static fault scan | L1 | automated | grep over the installed `node_modules` of a full bundle for `readFileSync`/`existsSync`/`require`/`import` of a `test`/`tests` path segment | scan script run in the task | zero hits, or each hit added to a pinned keep-list with a unit case |
| X4 | NSIS upgrade from previous release | state-transition (install→upgrade) | electron | automated | v-previous `Setup.exe` installed with `/S`, app started once | new `Setup.exe /S` over it, app started once, stopped | `~/.pi/agent/settings.json` `packages` contains `<install>\resources\server\node_modules\@blackbelt-technology\pi-dashboard-extension`; no entry ends with `packages\extension`; `/api/health` OK during the run |
| X5 | NSIS clean install still works | regression | L2 | automated | built `Setup.exe` | existing `qa/tests/windows-nsis-install.ps1` + `windows-nsis-launch.ps1` | both pass unchanged against the new layout |

---

## Coverage summary

- Requirements covered: 7/7 (MODIFIED "Bundled dashboard server ships the pi runtime"; ADDED prune helper, budget gate, install timing, NSIS upgrade; overlay "Bundled bridge extension lives under node_modules")
- Scenarios by class: edge 22 · perf 2 · frontend 0 · error 5
- Scenarios by level: L1 22 · L2 1 · L3 0 · electron 5 · ci 1
- Scenarios by disposition: automated 29 · manual-only 0

## New infra needed

- A win32-x64 CI step that downloads the previous release's `Setup.exe` (`gh release download`) and runs the upgrade (X4). It extends the existing NSIS smoke block in `_electron-build.yml`.
