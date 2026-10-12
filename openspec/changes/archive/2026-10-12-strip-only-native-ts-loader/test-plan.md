# Test Plan — strip-only-native-ts-loader

Stage: design   Generated: 2026-10-11

Hard-gate clarifications resolved with the user (2026-10-11):
- AppImage cold-boot pass criterion = the existing hard budget only (`/api/health` within 90 s); no relative-regression threshold.
- Upgrade continuity is automated as a CI job (last published release on Node 26 → in-place upgrade to the packed tarball).

Tier names (design D4): **T1** `registerHooks` + native strip (22.19+, 23.5+, 24, 25, 26) · **T2** `module.register` + native strip (23.2–23.4) · **T3** `module.register` + bundled `amaro` (23.0–23.1).

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | native-ts-loader · register module (tier selection) | decision-table | L1 | automated | stub `node:module` objects for the 4 combinations of {`registerHooks` present/absent} × {`stripTypeScriptTypes` present/absent}, `register` always present | import the register module's tier selector with each stub | (yes,yes)→T1 · (no,yes)→T2 · (no,no)→T3 · (yes,no)→T3, **not** T1 |
| E2 | native-ts-loader · register module (guard) | EP (invalid class) | L1 | automated | stub with neither `registerHooks` nor `register` | run the register module | throws; message contains `>=22.19.0 <27`; message contains neither `jiti` nor `PI_DASHBOARD_TS_LOADER` |
| E3 | native-ts-loader · `.js`→`.ts` resolution | EP | L1 | automated | fixture dir with `a.ts` importing `./b.js` where only `b.ts` exists | load `a.ts` under T1 hooks | `b.ts` evaluated with types stripped; export value equals expected |
| E4 | native-ts-loader · existing `.js` wins / bare specifier untouched | EP | L1 | automated | (a) both `b.js` and `b.ts` exist; (b) import of unresolvable bare `no-such-pkg` | load the importer under T1 | (a) `b.js` evaluated (marker value from `.js`); (b) rejection code `ERR_MODULE_NOT_FOUND`, specifier unchanged in message |
| E5 | native-ts-loader · JSON import attribute | EP | L1 | automated | `import data from "./data.json"` without `with { type: "json" }` | load under T1 | no `ERR_IMPORT_ATTRIBUTE_MISSING`; `data` deep-equals file contents |
| E6 | native-ts-loader · non-erasable syntax fails loudly | EP (invalid class) | L1 | automated | fixture `.ts` with `constructor(private x: number) {}`, and one with `enum E { A }` | load each under T1 | rejection message contains the fixture's absolute path; no module body executed (side-effect marker unset); no transpiled output |
| E7 | native-ts-loader · `require()` neutrality | state (CJS path) | L1 | automated | server process started with `--import <native-ts-register URL>` | `loadPurify()` sanitizes `<svg><script>x</script><g/></svg>` | returns `<svg><g></g></svg>` |
| E8 | native-ts-loader · amaro only on T3 | EP | L1 | automated | current Node (T1) running the register module plus one `.ts` import | inspect `require.cache` keys and the module-resolution log after load | no key or resolved URL containing `/amaro/` |
| E9 | native-ts-loader · warning filter | EP | L1 | automated | T1 hooks loaded; one `.ts` import; then `process.emitWarning("custom-x", "ExperimentalWarning")` | capture stderr | no line containing `stripTypeScriptTypes is an experimental feature`; the `custom-x` warning is printed |
| E10 | native-ts-loader · erasable-only gate | EP | L1 | automated | temp project under the repo extending `tsconfig.base.json`, file with a parameter property; second file with `enum` | run the repository type-checker (`node scripts/tsc7.mjs` once `migrate-typecheck-to-ts7` has landed, else `tsc`) with `--noEmit -p <temp>` | exit ≠ 0; output contains `TS1294` for each file |
| E11 | native-ts-loader · type-only import rule | EP | L1 | automated | fixture `import { Iface } from "./x.js"` where `Iface` is used only as a type | run `biome lint <fixture>` with repo config | exit ≠ 0; diagnostic `lint/style/useImportType` at error severity |
| E12 | openspec-change-state · ChangeState values | EP | L1 | automated | `import { ChangeState } from shared types` | read members | `Object.values(ChangeState)` deep-equals `["PLANNING","READY","IMPLEMENTING","COMPLETE"]`; `ChangeState.READY === "READY"` |
| E13 | design D1 · rewrite preserves key order | state (snapshot) | L1 | automated | 3 representative rewritten Node-loaded classes with both initialized fields and parameter properties, plus 1 `Error` subclass; key-order snapshot captured **before** the rewrite | construct each with fixed args after the rewrite | `Object.keys(instance)` and `JSON.stringify(instance)` equal the pre-rewrite snapshot |
| E14 | server-launch · legacy env var | decision-table | L1 | automated | `PI_DASHBOARD_TS_LOADER` ∈ {unset, `""`, `native`, `jiti`, `tsx`, `garbage`} | boot-time warning helper runs once in the server; wrapper and launcher run with the same env | unset/`""`/`native` → 0 warnings; others → exactly 1 warning naming `PI_DASHBOARD_TS_LOADER`; wrapper + launcher → 0 warnings; child env passed through unchanged |
| E15 | server-launch · native-only argv | EP | L1 | automated | `launchDashboardServer` with a stub spawner | launch | argv = `[node, "--import", <native-ts-register URL>, <cli>, …]`; log header contains `loader <native-ts-register URL>` |
| E16 | server-launch · no jiti installed | fault-injection (abort) | L1 | automated | resolver seam reporting no jiti anywhere | launcher, bin wrapper (stubbed exec) and bridge auto-start each start the server | each starts; no `cannot find jiti` / `JitiNotFoundError` text anywhere in output or logs |
| E17 | server-launch · restart normalization | decision-table | L1 | automated | `process.execArgv` ∈ {`--import <jiti-register URL>`, `--import <native URL>`, `--import file:///x/unknown-loader.mjs`, none} | `/api/restart` handler builds orchestrator params | orchestrator `loader` = native register URL in all 4 cases; `port` / `piPort` / `extraArgs` unchanged |
| E18 | server-launch · foreign-loader boot warning | decision-table | L1 | automated | boot check with `execArgv` ∈ {jiti URL, tsx URL, native URL} | server boot | jiti/tsx → 1 warning naming the loader and `pi-dashboard stop && pi-dashboard start`; native → 0 warnings |
| E19 | server-launch · worker loader | decision-table | L1 | automated | `workerExecArgv` inputs: inherited jiti `--import`, inherited native `--import`, no `--import` | compute worker `execArgv` | jiti → unchanged (one `--import`); native → unchanged; none → native register added; jiti never added |
| E20 | dashboard-server · Doctor TypeScript-loader row | decision-table | L1 | automated | {native register module resolves / does not} × {jiti and tsx installed / not} | build the Doctor row set | resolves → `ok` naming the register module path; missing → `error` + `doctor.ts_loader_not_found`; row and remediation never mention `tsx` or `jiti` |
| E21 | dashboard-server · bin wrapper | decision-table | L1 | automated | {register module resolvable / not} × argv {`status`, `--version`} | run the wrapper with a stubbed exec | resolvable+`status` → exec `node --import <native URL> …cli.ts status`; missing+`status` → stderr contains corrupted-install hint + `npm install -g @blackbelt-technology/pi-agent-dashboard`, exit 1, no jiti/tsx probe; `--version` (either) → prints `package.json` version, exit 0, no loader resolution |
| E22 | server-launch · removed predecessors | EP | L1 | automated | repository tree after the change | run the two `git grep` commands from the spec scenario (non-test sources) | both return zero matches |
| E23 | packaging · no jiti import in server source | EP | L1 | automated | `packages/server/src`, `packages/server/bin`, `packages/shared/src` (non-test) | search for `from "jiti"` / `require("jiti")` / `import("jiti")` | zero matches |
| E24 | design D4 · amaro release-deps rule | EP (invalid class) | L1 | automated | copy of `packages/shared/package.json` with `amaro` removed from `dependencies` | run `scripts/verify-release-deps.mjs` against it | exit ≠ 0; message names `amaro` and `packages/shared/package.json` |
| E25 | jiti-cjs-transpile-safety · scope unchanged | state (snapshot) | L1 | automated | file set computed by the gate before vs after the change | run the gate's scope derivation | after ⊇ before; includes `packages/server/src/changelog/changelog-fs.ts` and `packages/dashboard-plugin-runtime/src/server/**` |
| E26 | dashboard-plugin-loader · install-load gate on native loader | EP (invalid class) | L1 | automated | packed fixture plugin whose server entry imports a file with a parameter property | run `scripts/verify-plugin-install-load.mjs` on it | exit ≠ 0; output names the plugin and the offending file |
| E27 | dashboard-plugin-loader · non-erasable third-party plugin isolated | fault-injection (abort) | L1 | automated | two fixture plugins: A's server entry has a parameter property, B is valid | plugin loader loads both | B registered; A recorded as failed with an error naming A's file; loader does not throw |
| E28 | dashboard-plugin-loader · type-only import without `import type` in a plugin | fault-injection (abort) | L1 | automated | fixture plugin whose server entry has `import { OnlyAType } from "./types.js"` | plugin loader loads it under the native loader | plugin recorded as failed (link-time SyntaxError naming the missing export); other plugins load |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | design D4 · synchronous hooks on read-only bundle | threshold (cold boot) | electron | automated | AppImage launched on Ubuntu 22.04 container (FUSE, cold), per-phase timings logged | `/api/health` responds within 90 s | single cold launch per CI run |

### Frontend-quirk

None. The change has no rendered-UI behaviour.

### Error-handling (process / install / multi-runtime)

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | native-ts-loader · same loader on every supported line | EP over runtimes | ci | automated | none (matrix 22, 24, 25, 26) | `_smoke.yml` standalone install of packed tarballs, start server | `/api/health` 200 on every leg; `server.log` contains no `stripTypeScriptTypes is an experimental feature` and no `DEP0205` |
| X2 | native-ts-loader · EOL 23 tiers | EP over runtimes | ci | automated | Node 23.1.0 (T3) and 23.4.0 (T2) | install packed tarballs with `--config.engine-strict=false`, start server | `/api/health` 200 on both legs; no `MODULE_NOT_FOUND` for `amaro` in `server.log` |
| X3 | server-launch · real launch, native loader | state | L2 | automated | no jiti anywhere on the box (`node_modules/jiti` removed from the install) | `pi-dashboard start` | health 200; `server.log` header contains `native-ts-register.mjs`; no `jiti` in `server.log` |
| X4 | server-launch · legacy env var on a real launch | EP | L2 | automated | `PI_DASHBOARD_TS_LOADER=jiti` exported | `pi-dashboard start` | health 200; `server.log` has exactly 1 line naming `PI_DASHBOARD_TS_LOADER`; terminal output of the wrapper has none |
| X5 | electron-launch-source · bundled launch native | state | L2 | automated | none | Electron real launch (bundled Node 24) | health 200; `server.log` header names `native-ts-register.mjs` |
| X6 | file-and-url-preview · lazy CommonJS path on real server | fault-injection (n/a, lazy load) | L3 | automated | none | open a diagram preview whose Kroki SVG contains `<script>` (docker harness, derived port) | rendered SVG present; no `<script>` element in the preview DOM; server stays healthy |
| X7 | server-launch · upgrade continuity | state-transition | ci | automated | Node 26; last published release installed and started (runs under jiti via the old fallback) | upgrade in place to the packed tarballs, `POST /api/restart`, wait for health, `POST /api/restart` again | after restart 1: health 200 and `server.log` foreign-loader warning naming jiti; after restart 2: health 200 and the server's argv / log header name `native-ts-register.mjs` |

---

## Coverage summary

- Requirements covered: all ADDED/MODIFIED requirements in the 14 deltas with behavioural content. `electron-shell` lifecycle and `platform-primitives` are covered by X5 and E22; `debugging-skills` (skill text) has no behavioural observable and is covered by doc review in tasks §5.
- Scenarios by class: edge 28 · perf 1 · frontend 0 · error 7
- Scenarios by level: L1 28 · L2 3 · L3 1 · electron 1 · ci 3
- Scenarios by disposition: automated 36 · manual-only 0

## New infra needed

- **X2:** a CI job for EOL Node 23.1.0 / 23.4.0 (outside the `_smoke.yml` supported-set matrix, which deliberately leaves out 23).
- **X7:** a CI job that installs the last published release on Node 26, starts it, and upgrades in place to the packed tarballs.
