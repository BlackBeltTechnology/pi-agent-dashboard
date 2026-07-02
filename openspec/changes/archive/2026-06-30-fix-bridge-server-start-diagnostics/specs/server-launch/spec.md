## MODIFIED Requirements

### Requirement: Single shared dashboard-server spawn primitive

All runtime dashboard-server spawns SHALL go through `launchDashboardServer(opts)` exported from `packages/shared/src/server-launcher.ts`. No source file outside this module AND `node-spawn.ts` MAY construct `node --import <loader> <cli>` argv directly. Internally, `launchDashboardServer` SHALL delegate argv construction to `spawnNodeScript` in `packages/shared/src/platform/node-spawn.ts`, which itself uses the shared pure helper `buildNodeImportArgvParts({ loader, entry, args })`. The `restart-helper.ts` `node -e` orchestrator (which runs in a fresh process and cannot call `launchDashboardServer` directly) SHALL also call `buildNodeImportArgvParts` for argv construction.

**Env merge contract (clarified).** `launchDashboardServer` SHALL internally compute the spawn env as `ToolResolver.buildSpawnEnv(process.env)`, then overlay any caller-supplied `opts.env` on top with caller-wins semantics. Callers MUST NOT pass `env: { ...process.env }`. Callers SHALL pass `env` only when injecting narrow overrides (e.g. `DASHBOARD_STARTER`, `ELECTRON_RUN_AS_NODE`); otherwise `env` SHALL be omitted.

#### Scenario: Extension auto-spawn

- **WHEN** the bridge extension detects no running server and decides to auto-spawn
- **THEN** it calls `launchDashboardServer({ cliPath, stdio: { logFile: getServerLogPath() }, healthTimeoutMs: 10000, starter: "Bridge", port, ... })`
- **AND** the spawned server's stdout/stderr SHALL be captured to `~/.pi/dashboard/server.log` (the bridge path no longer uses `stdio: "ignore"`)
- **AND** does not import `resolveJitiImport` or call `child_process.spawn` for the server directly

#### Scenario: Slow cold start within the extended window

- **GIVEN** the bridge auto-spawn ran on a slow host where the server reaches `writePid()` but is not health-OK within 2 s
- **WHEN** the server becomes health-OK before `healthTimeoutMs` (10 s) elapses
- **THEN** `launchDashboardServer` SHALL resolve successfully (no `readiness timeout`)
- **AND** the bridge SHALL NOT emit a "failed to start" warning

#### Scenario: Failure copy references the written log

- **WHEN** the bridge auto-spawn fails (readiness timeout or `EarlyExitError`)
- **THEN** the warning surfaced by `server-auto-start.ts` and the `EarlyExitError` message SHALL reference the path returned by `getServerLogPath()` — the same file the bridge spawn now writes
- **AND** that file SHALL exist and contain the spawn header line plus any server stdout/stderr captured before failure

### Requirement: Caller-owned log-file policy

When `stdio: { logFile }` is supplied, `launchDashboardServer` SHALL:

- Create the parent directory with `mkdirSync(..., { recursive: true })`.
- Open the log file with `"a"` (append) mode.
- Write a single header line `[<ISO timestamp>] <starter?> launch (parent pid <pid>, port <port>, cli <cliPath>)\n` before passing the fd to the child.
- Pass the fd as both stdout and stderr in `spawnOptions.stdio`.
- Close the parent's fd after `spawn` returns (child retains its inherited copy).

The absolute log-file path is **caller-owned**. Conventions in the migrated tree:
- Extension (bridge auto-spawn): `stdio: { logFile: getServerLogPath() }` → `~/.pi/dashboard/server.log`.
- CLI (`cmdStart`): `~/.pi/dashboard/server.log`.
- Electron: existing electron log path (unchanged by this proposal).

#### Scenario: Extension auto-spawn writes the shared server log

- **WHEN** the bridge auto-spawns the server via `stdio: { logFile: getServerLogPath() }`
- **THEN** `~/.pi/dashboard/server.log` SHALL be created (if absent) with the header line written before the child sees the fd
- **AND** a subsequent `cat ~/.pi/dashboard/server.log` SHALL show the launch header and any captured server output, never "No such file or directory"
