## MODIFIED Requirements

### Requirement: Single shared dashboard-server spawn primitive

All runtime dashboard-server spawns SHALL go through `launchDashboardServer(opts)` exported from `packages/shared/src/server-launcher.ts`. No source file under `packages/*/src/` outside this module AND `node-spawn.ts` MAY construct dashboard-server `node --import <loader> <cli>` argv directly. Two exceptions are deliberate: the pre-loader CLI wrapper `packages/server/bin/pi-dashboard.mjs`, specified by `dashboard-server` "CLI bin entry resolves jiti at runtime", and per-line `ban:raw-node-import-ok` opt-outs for non-server Node children. Internally, `launchDashboardServer` SHALL delegate argv construction to `spawnNodeScript` in `packages/shared/src/platform/node-spawn.ts`, which itself uses the shared pure helper `buildNodeImportArgvParts({ loader, entry, args })`. The `restart-helper.ts` `node -e` orchestrator (which runs in a fresh process and cannot call `launchDashboardServer` directly) SHALL also call `buildNodeImportArgvParts` for argv construction.

**Env merge contract (clarified).** `launchDashboardServer` SHALL internally compute the spawn env as `ToolResolver.buildSpawnEnv(process.env)` (yielding PATH augmented with managed-dir, bundled-node, and pi-bin prepends), then overlay any caller-supplied `opts.env` on top with caller-wins semantics. **Callers MUST NOT pass `env: { ...process.env }` (or any equivalent that re-supplies the full `process.env`), because doing so overlays the raw, un-augmented `PATH` back over the augmented base, defeating the entire purpose of `buildSpawnEnv`.** Callers SHALL pass `env` only to inject narrow overrides (e.g. `DASHBOARD_STARTER`, `ELECTRON_RUN_AS_NODE`), or, as Electron's `spawnFromSource` does, an env built from `ToolResolver.buildSpawnEnv(process.env)` plus such overrides. In all other cases `env` SHALL be omitted.

#### Scenario: Entry-script URL-wrapping rule preserved

- **WHEN** the loader is jiti or tsx, on any host platform
- **THEN** the entry script is passed as a raw path (tsx rejects `file://` entries on every OS; jiti misnormalises `file:///` entries on Windows)
- **AND WHEN** the loader is neither jiti nor tsx AND the host platform is Windows
- **THEN** the entry script is URL-wrapped via `toFileUrl()`
- **AND WHEN** the loader is neither jiti nor tsx AND the host platform is POSIX
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
