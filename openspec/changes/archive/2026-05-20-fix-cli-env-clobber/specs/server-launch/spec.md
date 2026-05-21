## MODIFIED Requirements

### Requirement: Single shared dashboard-server spawn primitive

`packages/shared/src/server-launcher.ts` SHALL be the single shared spawn primitive used by every dashboard server launcher (Bridge auto-start, CLI `pi-dashboard start`, Electron `spawnFromSource`, restart-helper orchestrator). All launchers SHALL delegate jiti loader resolution, `node --import` argv construction, env merge, log-file open/append/close lifecycle, and readiness polling to this primitive.

**Env merge contract (clarified).** `launchDashboardServer` SHALL internally compute the spawn env as `ToolResolver.buildSpawnEnv(process.env)` (yielding PATH augmented with managed-dir, bundled-node, and pi-bin prepends), then overlay any caller-supplied `opts.env` on top with caller-wins semantics. **Callers MUST NOT pass `env: { ...process.env }` (or any equivalent that re-supplies the full `process.env`), because doing so overlays the raw, un-augmented `PATH` back over the augmented base, defeating the entire purpose of `buildSpawnEnv`.** Callers SHALL pass `env` only when they intend to inject narrow overrides (e.g. `DASHBOARD_STARTER`, `ELECTRON_RUN_AS_NODE`); for all other cases, `env` SHALL be omitted.

#### Scenario: Entry-script URL-wrapping rule preserved

- **WHEN** any caller invokes `launchDashboardServer`
- **THEN** the entry script is URL-wrapped iff `isTsxLoader(loader) === false`
- **AND** the loader argument is always a `file://` URL

#### Scenario: Extension auto-spawn

- **WHEN** the bridge extension's auto-start ladder reaches the spawn step
- **THEN** it calls `launchDashboardServer({ cliPath, anchor, stdio: "ignore", healthTimeoutMs: 2000, … })`
- **AND** does not import `resolveJitiImport` or call `child_process.spawn` for the server directly

#### Scenario: CLI `pi-dashboard start`

- **WHEN** `cmdStart` runs in `packages/server/src/cli.ts`
- **THEN** it calls `launchDashboardServer({ cliPath, stdio: { logFile }, healthTimeoutMs: 30000, starter: "Standalone", port })` **without** an `env` field
- **AND** the spawned child therefore inherits the augmented PATH from `ToolResolver.buildSpawnEnv(process.env)` (managed-dir + bundled-node + pi-bin prepended), not the raw `process.env.PATH`
- **AND** the regression-prevention test `cli-env-no-clobber.test.ts` SHALL fail if `packages/server/src/cli.ts` contains `env: { ...process.env }` anywhere

#### Scenario: Electron `spawnFromSource`

- **WHEN** Electron resolves a `LaunchSource` and spawns the server
- **THEN** it calls `launchDashboardServer({ cliPath: source.cliPath, anchor: source.cliPath, env, stdio: { logFile }, healthTimeoutMs: 15000, starter: "Electron", detach: false, … })` where `env` is built explicitly from `ToolResolver.buildSpawnEnv(process.env)` plus narrow override keys (`DASHBOARD_STARTER`, `ELECTRON_RUN_AS_NODE` when applicable)
- **AND** does NOT pass `env: { ...process.env }` — the raw process.env would overlay and clobber the augmented PATH

#### Scenario: Lint allow-list pinned to two files

- **WHEN** the repo-lint test `no-raw-node-import` runs
- **THEN** the `ALLOWLIST` constant contains exactly `packages/shared/src/platform/node-spawn.ts` and `packages/shared/src/server-launcher.ts`
- **AND** no source file in `packages/{extension,server,electron}/src/` contains the `ban:raw-node-import-ok` marker

#### Scenario: Restart orchestrator spawn

- **WHEN** the `/api/restart` orchestrator (`restart-helper.ts`) re-spawns the new server inside its embedded `node -e` script
- **THEN** the spawn argv is constructed via `buildNodeImportArgvParts` (the same builder used by `launchDashboardServer`)
- **AND** the env passed to the spawned `node -e` orchestrator process is `{ ...process.env }` (the orchestrator itself runs as a detached node process; its own env is inherited from the dying server; this is distinct from the env the orchestrator then passes to the new server child, which the orchestrator-embedded script handles via the same `launchDashboardServer` env contract)
