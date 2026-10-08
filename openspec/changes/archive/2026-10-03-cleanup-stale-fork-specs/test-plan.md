# Test Plan — cleanup-stale-fork-specs

Stage: design   Generated: 2026-10-03

Spec-only change. Every ADDED or MODIFIED requirement is rewritten to match current code, so each scenario below asserts that current behaviour. For each row, ship-it first checks whether the cited existing test already pins it ("verify"). Where it doesn't, ship-it adds a test-only assertion ("add"). REMOVED requirements produce no rows: their code is already gone. Spec-level checks (`openspec validate`, cross-reference sweeps) are validation tasks in tasks.md, not scenarios.

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | server-launch: entry-wrap rule (jiti/tsx arm) | decision-table | L1 | automated | jiti loader `C:\u\node_modules\jiti\lib\jiti-register.mjs`; tsx loader `/x/tsx/dist/esm/index.mjs`; entry `C:\srv\cli.ts`; `platform` ∈ {`win32`, `linux`, `darwin`} | `buildNodeImportArgvParts` | argv[2] === `C:\srv\cli.ts` (raw) for all 6 combos; argv[1] starts with `file:///` |
| E2 | server-launch: entry-wrap rule (other-loader arm) | decision-table | L1 | automated | loader `C:\x\loader.mjs` (neither `tsx/` nor `jiti/` segment); entry `C:\srv\cli.ts` | `buildNodeImportArgvParts` with `platform` `win32`, then `linux` | `win32` → argv[2] === `file:///C:/srv/cli.ts`; `linux` → argv[2] === `C:\srv\cli.ts` |
| E3 | dashboard-server: Canonical argv helpers — loader identity | EP | L1 | automated | `C:\x\node_modules\tsx\dist\esm\index.mjs`; `file:///a/node_modules/jiti/lib/jiti-register.mjs`; `/usr/bin/node-loader.mjs` | `isTsxLoader`, `isJitiLoader` | tsx path → (true, false); jiti path → (false, true); other → (false, false) |
| E4 | dashboard-server: Canonical argv helpers — toFileUrl | BVA | L1 | automated | `file:///C:/foo.ts`; `B:\Dev\cli.ts`; `B:/Dev/cli.ts`; `/usr/local/bin/cli.js` | `toFileUrl` on a POSIX host | unchanged; `file:///B:/Dev/cli.ts` (×2); `file:///usr/local/bin/cli.js` |
| E5 | dashboard-server: Canonical argv helpers — spawnNodeScript delegates | EP | L1 | automated | `spawnNodeScript({ loader, entry, args })` with the exec layer stubbed | spawn | the stub receives argv equal to `buildNodeImportArgvParts({ loader, entry, args })` |
| E6 | electron-shell: `shouldUrlWrapEntry()` documents the jiti URL-entry breakage | EP | L1 | automated | source text of `packages/shared/src/platform/node-spawn.ts` | read file | contains `JITI VERSION CONTRACT`, a `file:/…file:/` or "misnormalis/ze" marker, and "re-verify" or "per-version branch"; test source has no `offline-packages.json` read |
| E7 | dashboard-server: CI detects raw paths — staged violation | EP | L1 | automated | fixture source text `spawn(process.execPath, ["--import", loader, rawPath])` in a temp file | run the lint scanner function against the fixture | one violation reported with the fixture file name and line 1 |
| E8 | dashboard-server: CI detects raw paths — exemptions | decision-table | L1 | automated | scanner `ALLOWLIST` constant; repo `packages/*/src` tree | lint run | `ALLOWLIST` equals exactly [`packages/shared/src/platform/node-spawn.ts`, `packages/shared/src/server-launcher.ts`]; 0 violations on the real tree |
| E9 | server-launch: opt-out marker scope | EP | L1 | automated | `packages/{extension,server,electron}/src/**` excluding `__tests__` | grep for `ban:raw-node-import-ok` | exactly one hit: `packages/server/src/attachments/fit-worker-pool.ts` |
| E10 | electron-build-pipeline: Bundled dashboard server ships the pi runtime — declarations | EP | L1 | automated | `packages/server/package.json`; source of `packages/electron/scripts/bundle-server.mjs` | read + parse | server `dependencies` contain `@earendil-works/pi-coding-agent`, `@fission-ai/openspec`, `tsx`, and no `@mariozechner/pi-coding-agent`; `bundlePkg` literal has `workspaces` and no `dependencies` key; `BUNDLED_WORKSPACE_PKGS` = [server, shared, extension, dashboard-plugin-runtime] |
| E11 | electron-build-pipeline: NSIS install location — launch source | state-transition | L1 | automated | `selectLaunchSource` probes: no attach, no localLink, no overlay; `resourcesPath` = `D:\MyApps\PI Dashboard\resources` with bundled `cli.ts` present | resolve | returns `{ kind: "bundled", cliPath: <resourcesPath>/server/node_modules/@blackbelt-technology/pi-dashboard-server/src/cli.ts }`; identical shape for `%LOCALAPPDATA%\Programs\PI Dashboard\resources` |
| E12 | electron-build-pipeline: NSIS — no hardcoded install path | EP | L1 | automated | `packages/{electron,server,shared}/src/**/*.ts` excluding `__tests__` | scan non-comment lines for `Programs\PI Dashboard` | 0 hits outside comments/doc strings |
| E13 | electron-build-pipeline: Local builder — arch-cache invalidation | EP | L1 | automated | source of `packages/electron/scripts/build-installer.sh` | read file | wipes `resources/node` and `resources/server` on arch change; contains no `offline-packages`; invokes `bundle-server.mjs` (not `.sh`) under `arch -x86_64` for x64 cross builds |
| E14 | electron-shell: Electron main process lifecycle — launch path | state-transition | L1 | automated | no discovered server; resolved `bundled` LaunchSource | `spawnFromSource` | `launchDashboardServer` called with `cliPath: source.cliPath`; no `tsx` binary resolved or spawned |
| E15 | electron-shell: Doctor diagnostic function — row set | EP | L1 | automated | Doctor run with all probes stubbed ok | build report | no row named or messaged "offline packages"; a "TypeScript loader" row is present |
| E16 | server-launch: CLI `pi-dashboard start` call shape | EP | L1 | automated | `cmdStart` with `launchDashboardServer` stubbed | run `start` | stub called with `cliPath`, `extraArgs`, `stdio.logFile`, `healthTimeoutMs: 30000`, `starter: "Standalone"`, `port`, and no `env` key |
| E17 | server-launch: Restart orchestrator env | EP | L1 | automated | `process.env` with `NODE_OPTIONS="--max-old-space-size=1024"`; config `serverHeap.maxOldSpaceMb = 4096` | `spawnRestart` with spawn stubbed | spawn `env` = `buildRestartEnv(process.env, 4096)`: `NODE_OPTIONS` carries `--max-old-space-size=4096`, other keys copied |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | dashboard-server: CLI bin entry — jiti miss | fault-injection (abort) | L1 | automated | wrapper copied to a temp dir with no resolvable jiti package | `node pi-dashboard.mjs start` | exit code 1; stderr begins `pi-dashboard: cannot find jiti.` and contains `corrupted` and `npm install -g @blackbelt-technology/pi-agent-dashboard`; no `tsx` resolution attempted |
| X2 | dashboard-server: CLI bin entry — metadata short-circuit | fault-injection (abort) | L1 | automated | same jiti-less temp install with a valid sibling `package.json` (`version: "9.9.9"`) | `node pi-dashboard.mjs --version` | exit 0; stdout `9.9.9` |
| X3 | dashboard-server: Startup fails hard when pi cannot be resolved | fault-injection (abort) | L1 | automated | tool registry stubbed so `resolve("pi")` returns `{ ok: false, tried: [{strategy:"a"},{strategy:"b"}] }` | `runForeground` past `createServer` | rejects with message containing `corrupted node_modules/ tree` and `a, b`; no install function invoked; `cli.ts` contains none of the forbidden bootstrap symbols |
| X4 | dashboard-server: Startup — happy path log | fault-injection (none) | L1 | automated | registry `resolve("pi")` → `{ ok: true, source: "bundled" }` | `runForeground` | stdout contains `[bootstrap] ready (pi resolved via bundled)` |
| X5 | electron-build-pipeline: Bundled-extensions step removed | EP | L1 | automated | `.github/workflows/_electron-build.yml`, `publish.yml` | read workflows | no reference to `bundle-recommended-extensions` or `bundle-server.sh`; server bundling runs `node …/bundle-server.mjs` |

## Coverage summary

- Requirements covered: 11/11 ADDED or MODIFIED requirements. The 31 REMOVED requirements need no scenario because their implementation is already gone; X5 additionally guards one of them.
- Scenarios by class: edge 17 · perf 0 · frontend 0 · error 5
- Scenarios by level: L1 22 · L2 0 · L3 0
- Scenarios by disposition: automated 22 · manual-only 0

## New infra needed

- none. E7 needs the `no-raw-node-import` scanner logic callable on a fixture. That is a test-only refactor inside the test file, not new infra.
