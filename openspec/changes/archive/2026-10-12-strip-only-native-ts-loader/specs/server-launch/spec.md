## ADDED Requirements

### Requirement: Native TypeScript loader is the only server loader

Every dashboard-server launch (CLI wrapper, `launchDashboardServer` from CLI / Electron / bridge auto-start, Electron launch helpers, the restart orchestrator) and every server worker thread SHALL use the Node-native TypeScript loader. No launch path SHALL resolve, select, or inject jiti. Node launch sites SHALL locate the native register module by package specifier (`@blackbelt-technology/pi-dashboard-shared/platform/native-ts-register.mjs`) from the launch anchor, not by directory arithmetic; the shell launch helpers (`start-server.{sh,cmd,ps1}`), which cannot resolve packages, SHALL use the bundle's fixed layout path to that file. The spawn log header SHALL name the loader. The bundled-server plugin-load build gate SHALL boot with the native loader. `PI_DASHBOARD_TS_LOADER` SHALL NOT influence any launch path. When it is set to a value other than empty or `native` (both silent), the **dashboard server process** SHALL log one warning at boot (to `server.log`) that the variable is no longer supported; wrappers and launchers SHALL neither warn nor rewrite the environment. `/api/restart` SHALL hand the restart orchestrator the native register module as its loader, whatever loader the running process's `execArgv` carries (for example jiti inherited from a server started before this change); the orchestrator's own argv branches are unchanged. A server that boots under a non-native TypeScript loader SHALL log a warning recommending a fresh start.

#### Scenario: Launch uses the native loader

- **WHEN** `launchDashboardServer` runs
- **THEN** the child argv SHALL be `--import <native-ts-register.mjs URL> <cli>`
- **AND** the spawn log header SHALL contain `loader <native-ts-register.mjs URL>`

#### Scenario: Explicit native value stays silent

- **WHEN** `PI_DASHBOARD_TS_LOADER=native` is set
- **THEN** no warning SHALL be logged and the native loader SHALL be used

#### Scenario: Legacy loader variable is ignored with a warning

- **WHEN** `PI_DASHBOARD_TS_LOADER=jiti` is set in the launching process environment
- **THEN** exactly one warning naming `PI_DASHBOARD_TS_LOADER` as unsupported SHALL be logged
- **AND** the child argv SHALL use the native register module

#### Scenario: No jiti installed anywhere

- **WHEN** no jiti package resolves from any anchor
- **THEN** `launchDashboardServer`, the CLI wrapper and the bridge auto-start SHALL start the server normally
- **AND** no "cannot find jiti" message SHALL be emitted

#### Scenario: Node 26 does not fall back

- **WHEN** the server is launched on Node 26 (no transform-mode type stripping)
- **THEN** the native loader SHALL be used

#### Scenario: Only the server warns

- **WHEN** `pi-dashboard start` runs with `PI_DASHBOARD_TS_LOADER=jiti` (wrapper → CLI → `launchDashboardServer` → server)
- **THEN** the wrapper and launcher SHALL NOT warn
- **AND** the server SHALL write exactly one unsupported-variable warning to `server.log` at boot

#### Scenario: Restart normalizes an inherited jiti loader

- **GIVEN** a running server whose `execArgv` contains `--import <jiti-register URL>`
- **WHEN** `/api/restart` is invoked on a server running this change's code
- **THEN** the orchestrator SHALL receive the native register module as its loader
- **AND** the re-launched server's argv SHALL use the native register module

#### Scenario: Server under a foreign loader warns at boot

- **WHEN** the server boots with a non-native TypeScript loader in its `execArgv`
- **THEN** it SHALL log a warning naming the loader and recommending `pi-dashboard stop && pi-dashboard start`

#### Scenario: Worker threads use the native loader

- **WHEN** a server running under the native loader spawns a `.ts` worker from a worker pool
- **THEN** the worker SHALL run under the native loader inherited from the server's `execArgv`, or added when no loader is inherited
- **AND** jiti SHALL NOT be added to the worker's `execArgv`, and an inherited loader of any kind SHALL count as present (no second `--import` is added)

## MODIFIED Requirements

### Requirement: Single shared dashboard-server spawn primitive

All runtime dashboard-server spawns SHALL go through `launchDashboardServer(opts)` exported from `packages/shared/src/server-launcher.ts`. No source file under `packages/*/src/` outside this module AND `node-spawn.ts` MAY construct dashboard-server `node --import <loader> <cli>` argv directly. Two exceptions are deliberate: the pre-loader CLI wrapper `packages/server/bin/pi-dashboard.mjs`, specified by `dashboard-server` "CLI bin entry uses the native TypeScript loader (no tsx fallback)", and per-line `ban:raw-node-import-ok` opt-outs for non-server Node children. Internally, `launchDashboardServer` SHALL delegate argv construction to `spawnNodeScript` in `packages/shared/src/platform/node-spawn.ts`, which itself uses the shared pure helper `buildNodeImportArgvParts({ loader, entry, args })`. The `restart-helper.ts` `node -e` orchestrator (which runs in a fresh process and cannot call `launchDashboardServer` directly) SHALL also call `buildNodeImportArgvParts` for argv construction.

**Env merge contract (clarified).** `launchDashboardServer` SHALL internally compute the spawn env as `ToolResolver.buildSpawnEnv(process.env)` (yielding PATH augmented with managed-dir, bundled-node, and pi-bin prepends), then overlay any caller-supplied `opts.env` on top with caller-wins semantics. **Callers MUST NOT pass `env: { ...process.env }` (or any equivalent that re-supplies the full `process.env`), because doing so overlays the raw, un-augmented `PATH` back over the augmented base, defeating the entire purpose of `buildSpawnEnv`.** Callers SHALL pass `env` only to inject narrow overrides (e.g. `DASHBOARD_STARTER`, `ELECTRON_RUN_AS_NODE`), or, as Electron's `spawnFromSource` does, an env built from `ToolResolver.buildSpawnEnv(process.env)` plus such overrides. In all other cases `env` SHALL be omitted.

#### Scenario: Entry-script URL-wrapping rule preserved

- **WHEN** the loader is the native loader (`platform/native-ts-register.mjs`), or any jiti/tsx loader string the `shouldUrlWrapEntry` classifier still recognises, on any host platform
- **THEN** the entry script is passed as a raw path (tsx rejects `file://` entries on every OS; jiti misnormalises `file:///` entries on Windows; under any `--import` loader Node runs the main entry through `path.resolve()` before building its URL, so a `file:///` entry fails on Windows)
- **AND WHEN** the loader is none of those AND the host platform is Windows
- **THEN** the entry script is URL-wrapped via `toFileUrl()`
- **AND WHEN** the loader is none of those AND the host platform is POSIX
- **THEN** the entry script is passed as a raw path
- **AND** the loader position is always URL-wrapped via `toFileUrl()`
- **AND** this rule is owned by `shouldUrlWrapEntry(loader, platform)` in `node-spawn.ts` and pinned by tests in `node-spawn.test.ts` and `node-spawn-jiti-contract.test.ts`; `server-launcher.test.ts` pins only that the launcher forwards `cliPath` unchanged to `spawnNodeScript`

#### Scenario: Extension auto-spawn

- **WHEN** the bridge extension detects no running server and decides to auto-spawn
- **THEN** it calls `launchDashboardServer({ cliPath, stdio: { logFile: getDashboardServerLogPath() }, healthTimeoutMs: 10000, starter: "Bridge", port, ... })`
- **AND** the spawned server's stdout/stderr SHALL be captured to `~/.pi/dashboard/server.log` (the bridge path no longer uses `stdio: "ignore"`)
- **AND** does not import `resolveJitiImport` or call `child_process.spawn` for the server directly

#### Scenario: Slow cold start within the extended window

- **GIVEN** the bridge auto-spawn ran on a slow host where the server reaches `writePid()` but is not health-OK within 2 s
- **WHEN** the server becomes health-OK before `healthTimeoutMs` (10 s) elapses
- **THEN** `launchDashboardServer` SHALL resolve successfully (no `readiness timeout`)
- **AND** the bridge SHALL NOT emit a "failed to start" warning

#### Scenario: Failure copy references the written log

- **WHEN** the bridge auto-spawn fails (readiness timeout or `EarlyExitError`)
- **THEN** the warning surfaced by `server-auto-start.ts` and the `EarlyExitError` message SHALL reference the path returned by `getDashboardServerLogPath()` — the same file the bridge spawn now writes
- **AND** that file SHALL exist and contain the spawn header line plus any server stdout/stderr captured before failure

#### Scenario: CLI `pi-dashboard start`

- **WHEN** `cmdStart` runs in `packages/server/src/cli.ts`
- **THEN** it calls `launchDashboardServer({ cliPath, extraArgs: args, stdio: { logFile }, healthTimeoutMs: 30000, starter: "Standalone", port })` **without** an `env` field
- **AND** the spawned child therefore inherits the augmented PATH from `ToolResolver.buildSpawnEnv(process.env)` (managed-dir + bundled-node + pi-bin prepended), not the raw `process.env.PATH`
- **AND** the regression-prevention test `cli-env-no-clobber.test.ts` SHALL fail if `packages/server/src/cli.ts` contains `env: { ...process.env }` anywhere

#### Scenario: Electron `spawnFromSource`

- **WHEN** Electron resolves a `LaunchSource` and spawns the server
- **THEN** it calls `launchDashboardServer({ cliPath: source.cliPath, anchor: source.cliPath, env, stdio: { logFile }, healthTimeoutMs: 15000, starter: "Electron", detach: false, … })` where `env` is built explicitly from `ToolResolver.buildSpawnEnv(process.env)` plus narrow override keys (`DASHBOARD_STARTER`, `ELECTRON_RUN_AS_NODE` when applicable)
- **AND** does NOT pass `env: { ...process.env }` — the raw process.env would overlay and clobber the augmented PATH

#### Scenario: Lint allow-list pinned to two files

- **WHEN** the repo-lint test `no-raw-node-import` runs
- **THEN** the `ALLOWLIST` constant contains exactly `packages/shared/src/platform/node-spawn.ts` and `packages/shared/src/server-launcher.ts`
- **AND** the only `ban:raw-node-import-ok` marker in `packages/{extension,server,electron}/src/` is the worker `execArgv` line in `packages/server/src/attachments/fit-worker-pool.ts`, which is not a dashboard-server spawn

#### Scenario: Restart orchestrator spawn

- **WHEN** the `/api/restart` orchestrator (`restart-helper.ts`) re-spawns the new server inside its embedded `node -e` script
- **THEN** the spawn argv is constructed via `buildNodeImportArgvParts` (the same builder used by `launchDashboardServer`)
- **AND** the env passed to the spawned `node -e` orchestrator process is `buildRestartEnv(process.env, <configured serverHeap.maxOldSpaceMb>)`: a copy of the dying server's env with the configured heap ceiling re-stamped (see "The dashboard server's heap ceiling is config-derived"). The orchestrator hands this env to the new server unchanged.

### Requirement: Removed predecessors

The following symbols SHALL NOT exist and SHALL NOT be reintroduced. The dashboard server no longer resolves or selects jiti (see "Native TypeScript loader is the only server loader"):

- `packages/shared/src/resolve-jiti.ts` (file deleted; `resolveJitiImport`, `resolveJitiFromAnchor`, `buildJitiRegisterUrl`, `pickJitiRegisterUrl` and `pickJitiFromAnchor` were first subsumed into `ToolResolver.resolveJiti`, which is itself now removed).
- `ToolResolver.resolveJiti` and the `JitiResolver` resolver-injection seam in `packages/shared/src/platform/binary-lookup.ts`.
- `selectTsLoader` and `nativeTransformSupported` in `packages/shared/src/platform/ts-loader-select.mjs`.
- `packages/electron/src/lib/ts-loader-resolver.ts` (file deleted).
- `resolveJitiFromPi` export in `packages/electron/src/lib/server-lifecycle.ts`.
- `deps.resolveJitiFromAnchor` injection seam in `packages/electron/src/lib/launch-source.ts`.

#### Scenario: Symbol-presence check

- **WHEN** the source tree is checked
- **THEN** `git grep -nwE '(resolveJitiImport|resolveJitiFromAnchor|resolveJitiFromPi|pickJitiRegisterUrl|pickJitiFromAnchor|buildJitiRegisterUrl|resolveJiti|selectTsLoader|nativeTransformSupported)[[:space:]]*\(' -- packages/ ':!packages/**/dist/**' ':!packages/**/out/**' ':!packages/electron/resources/**' ':!packages/**/__tests__/**'` returns zero matches (POSIX classes, because `git grep -E` does not honour `\b` / `\s`; call-shaped mentions in comments count as matches)
- **AND** `git grep -nwE 'ts-loader-resolver' -- 'packages/**/*.ts' ':!packages/**/dist/**' ':!packages/**/out/**' ':!packages/electron/resources/**'` returns zero matches
- **AND** `git grep -nwE '(JitiResolver|JitiNotFoundError|_?resolveJiti|selectTsLoader|nativeTransformSupported)' -- 'packages/**/*.ts' 'packages/**/*.mjs' 'packages/**/*.mts' ':!packages/**/dist/**' ':!packages/**/out/**' ':!packages/electron/resources/**' ':!packages/**/__tests__/**'` returns zero matches (word match, not call-shaped, so injection seams and type positions are caught too)

## REMOVED Requirements

### Requirement: TypeScript loader selection with native default
**Reason**: There is only one loader now. Node 26 has no transform mode, so the jiti alternative had become a silent, unspecified fallback that brought back the cold-boot regression.
**Migration**: Remove `PI_DASHBOARD_TS_LOADER` from launch environments; it is ignored with a warning. Roll back by installing the previous release. See "Native TypeScript loader is the only server loader".

### Requirement: Unified jiti resolution via `ToolResolver` anchored at earendil pi
**Reason**: No dashboard-server launch path resolves jiti any more. `ToolResolver.resolveJiti` and its resolver seam are deleted.
**Migration**: None for users. Code that resolved the server loader uses `resolveNativeTsLoader` from `platform/ts-loader-select.mjs`.
