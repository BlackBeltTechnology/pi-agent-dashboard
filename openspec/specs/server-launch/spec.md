# server-launch

## Purpose

Unified primitive for spawning the dashboard server across all callers (extension auto-spawn, CLI `pi-dashboard start`, Electron `spawnFromSource`, restart orchestrator). Centralises argv construction, jiti loader resolution, readiness polling, and log-file handling so behaviour stays consistent across runtime hosts and TypeScript loader sources.

## Requirements

### Requirement: Single shared dashboard-server spawn primitive

All runtime dashboard-server spawns SHALL go through `launchDashboardServer(opts)` exported from `packages/shared/src/server-launcher.ts`. No source file outside this module AND `node-spawn.ts` MAY construct `node --import <loader> <cli>` argv directly. Internally, `launchDashboardServer` SHALL delegate argv construction to `spawnNodeScript` in `packages/shared/src/platform/node-spawn.ts`, which itself uses the shared pure helper `buildNodeImportArgvParts({ loader, entry, args })`. The `restart-helper.ts` `node -e` orchestrator (which runs in a fresh process and cannot call `launchDashboardServer` directly) SHALL also call `buildNodeImportArgvParts` for argv construction.

**Env merge contract (clarified).** `launchDashboardServer` SHALL internally compute the spawn env as `ToolResolver.buildSpawnEnv(process.env)` (yielding PATH augmented with managed-dir, bundled-node, and pi-bin prepends), then overlay any caller-supplied `opts.env` on top with caller-wins semantics. **Callers MUST NOT pass `env: { ...process.env }` (or any equivalent that re-supplies the full `process.env`), because doing so overlays the raw, un-augmented `PATH` back over the augmented base, defeating the entire purpose of `buildSpawnEnv`.** Callers SHALL pass `env` only when they intend to inject narrow overrides (e.g. `DASHBOARD_STARTER`, `ELECTRON_RUN_AS_NODE`); for all other cases, `env` SHALL be omitted.

#### Scenario: Entry-script URL-wrapping rule preserved

- **WHEN** the loader is jiti AND the host platform is POSIX
- **THEN** the entry script is passed as a raw path (jiti's resolver mishandles `file://` URL entries on POSIX)
- **AND WHEN** the host platform is Windows OR the loader is tsx
- **THEN** the entry script is URL-wrapped via `toFileUrl()`
- **AND** this rule is owned by `shouldUrlWrapEntry(loader)` in `node-spawn.ts` and pinned by tests in both `node-spawn.test.ts` and `server-launcher.test.ts`

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

### Requirement: Readiness policy with four termination conditions

`launchDashboardServer` SHALL poll `isDashboardRunning(port)` from `packages/shared/src/server-identity.ts` until exactly one of these terminates the wait:

- `running === true` → resolve with `{ healthOk: true, reportedPid: status.pid ?? null, childPid: child.pid }`.
- `portConflict === true` → throw `PortConflictError`.
- `child.exitCode !== null` (child died mid-poll) → throw `EarlyExitError({ code: child.exitCode })`.
- `healthTimeoutMs` elapsed → throw `Error("readiness timeout")`.

#### Scenario: Identity verification rejects foreign service on port

- **WHEN** another (non-dashboard) service occupies the target port
- **THEN** `isDashboardRunning` returns `portConflict: true`
- **AND** `launchDashboardServer` throws `PortConflictError` instead of treating the foreign service as success

#### Scenario: Early-exit detection beats timeout

- **WHEN** the spawned child exits during the readiness poll
- **THEN** `launchDashboardServer` throws `EarlyExitError` carrying the child exit code on the next poll tick
- **AND** does not wait for the full `healthTimeoutMs` window

#### Scenario: Dual PID surfaced

- **WHEN** the server reaches health-ok
- **THEN** the resolved value carries both `childPid` (the spawned process pid) and `reportedPid` (from `/api/health`, matching `~/.pi/dashboard/dashboard.pid` once written)
- **AND** callers MAY use `reportedPid ?? readPid() ?? childPid` for the user-visible PID (cli.ts pattern)

### Requirement: Caller-owned log-file policy

When `stdio: { logFile }` is supplied, `launchDashboardServer` SHALL:

- Create the parent directory with `mkdirSync(..., { recursive: true })`.
- Open the log file with `"a"` (append) mode.
- Write a single header line `[<ISO timestamp>] <starter?> launch (parent pid <pid>, port <port>, cli <cliPath>)\n` before passing the fd to the child.
- Pass the fd as both stdout and stderr in `spawnOptions.stdio`.
- Close the parent's fd after `spawn` returns (child retains its inherited copy).

The absolute log-file path is **caller-owned**. Conventions in the migrated tree:
- Extension (bridge auto-spawn): `stdio: { logFile: getDashboardServerLogPath() }` → `~/.pi/dashboard/server.log`.
- CLI (`cmdStart`): `~/.pi/dashboard/server.log`.
- Electron: existing electron log path (unchanged by this proposal).

#### Scenario: Extension auto-spawn writes the shared server log

- **WHEN** the bridge auto-spawns the server via `stdio: { logFile: getDashboardServerLogPath() }`
- **THEN** `~/.pi/dashboard/server.log` SHALL be created (if absent) with the header line written before the child sees the fd
- **AND** a subsequent `cat ~/.pi/dashboard/server.log` SHALL show the launch header and any captured server output, never "No such file or directory"

#### Scenario: Header line written before child sees fd

- **WHEN** `launchDashboardServer({ stdio: { logFile } })` runs
- **THEN** the log file contains the header line for this launch on the first byte after the previous run's content (append mode preserves history)
- **AND** the parent process closes its copy of the fd after `spawn`

### Requirement: Unified jiti resolution via `ToolResolver`

`ToolResolver.resolveJiti({ anchor?, resolver? })` SHALL be the single source of truth for resolving pi's `jiti-register.mjs`. Resolution order: managed pi install (`~/.pi-dashboard/node_modules/<pi-pkg>` for each entry of `["@earendil-works/pi-coding-agent", "@mariozechner/pi-coding-agent"]`, primary then legacy) → system pi via `which("pi")` → caller-supplied `opts.anchor` walked up to nearest `node_modules` → `process.argv[1]` walked up. For every anchor, the inner walk SHALL try `JITI_PACKAGES = ["jiti", "@mariozechner/jiti"]` (upstream first, legacy fallback). Returns the register hook as a `file://` URL string (preserving the Windows drive-letter URL-wrapping contract documented on the prior `buildJitiRegisterUrl` helper) or null. The optional `resolver` parameter SHALL be the same `JitiResolver` test-injection seam currently exposed by `pickJitiRegisterUrl` / `pickJitiFromAnchor`, carried over so existing tests port without rewrite.

#### Scenario: Managed pi present (upstream)

- **WHEN** `~/.pi-dashboard/node_modules/@earendil-works/pi-coding-agent` exists and resolves `jiti/package.json`
- **THEN** `resolveJiti()` returns a `file://` URL pointing at the upstream `jiti/lib/jiti-register.mjs`

#### Scenario: Managed pi present (legacy fork)

- **WHEN** managed pi is the legacy `@mariozechner/pi-coding-agent` shipping `@mariozechner/jiti`
- **THEN** `resolveJiti()` falls through to the legacy package and returns its register URL

#### Scenario: System pi only

- **WHEN** managed pi is absent but `which("pi")` resolves and pi's tree contains jiti
- **THEN** `resolveJiti()` returns the system pi's `jiti-register.mjs` as a `file://` URL

#### Scenario: Anchor walk-up (Electron packaged)

- **WHEN** `process.argv[1]` is empty or a flag (packaged Electron) and `opts.anchor` is a valid `cliPath` inside a `node_modules` tree containing jiti
- **THEN** `resolveJiti({ anchor: cliPath })` returns the jiti URL resolved from that tree

#### Scenario: Windows drive-letter wrapping

- **WHEN** the resolved jiti path begins with `B:\` or any other URL-scheme-colliding drive letter
- **THEN** `resolveJiti()` returns `file:///B:/.../jiti-register.mjs` (drive letter URL-wrapped, backslashes normalised to forward slashes)

#### Scenario: All sources missing

- **WHEN** none of managed, system, anchor, or argv yield a jiti path
- **THEN** `resolveJiti()` returns null
- **AND** `launchDashboardServer` raises `JitiNotFoundError` when its caller did not supply a usable anchor

### Requirement: Removed predecessors

The following symbols SHALL be removed once all call sites are migrated:

- `packages/shared/src/resolve-jiti.ts` (file deleted; `resolveJitiImport`, `resolveJitiFromAnchor`, `buildJitiRegisterUrl`, `pickJitiRegisterUrl`, `pickJitiFromAnchor`, and the `JitiResolver` type all subsumed into `ToolResolver.resolveJiti` — the resolver-injection seam is preserved verbatim).
- `packages/electron/src/lib/ts-loader-resolver.ts` (file deleted).
- `resolveJitiFromPi` export in `packages/electron/src/lib/server-lifecycle.ts`.
- `deps.resolveJitiFromAnchor` injection seam in `packages/electron/src/lib/launch-source.ts`.

#### Scenario: Symbol-presence check

- **WHEN** the migration is complete
- **THEN** `git grep -nE '\b(resolveJitiImport|resolveJitiFromAnchor|resolveJitiFromPi|pickJitiRegisterUrl|pickJitiFromAnchor|buildJitiRegisterUrl)\s*\(' -- packages/ ':!packages/**/dist/**' ':!packages/**/out/**'` returns zero matches (no remaining invocations of the deleted symbols; historical references in doc-comments are fine)
- **AND** `git grep -nwE 'ts-loader-resolver' -- packages/ ':!packages/**/dist/**' ':!packages/**/out/**'` returns zero matches against `.ts` source files (only the deleted file's name)

### Requirement: Electron-host callers MUST supply an explicit Node binary

When `launchDashboardServer(opts)` is called from `packages/electron/src/lib/**`, the caller SHALL pass an explicit `opts.nodeBin` resolving to a real Node interpreter binary, OR (when no real Node binary is available) SHALL set `opts.env.ELECTRON_RUN_AS_NODE = "1"` so the Electron `process.execPath` fallback executes as Node rather than re-launching the GUI. Electron callers SHALL NOT rely on the bare `nodeBin ?? process.execPath` fallback inside `launchDashboardServer`.

#### Scenario: Bundled-node case sets nodeBin

- **WHEN** an Electron caller invokes `launchDashboardServer` AND the bundled Node binary is present at the path returned by `getBundledNodePath()`
- **THEN** the caller SHALL pass `opts.nodeBin = <bundled-node-path>`
- **AND** the spawned child SHALL be the bundled Node binary, not the Electron GUI binary

#### Scenario: System-node case sets nodeBin

- **WHEN** an Electron caller invokes `launchDashboardServer` AND no bundled Node is available AND `detectSystemNode()` reports a version-safe system Node
- **THEN** the caller SHALL pass `opts.nodeBin = <system-node-path>`

#### Scenario: execPath fallback requires ELECTRON_RUN_AS_NODE

- **WHEN** an Electron caller invokes `launchDashboardServer` AND neither a bundled nor a version-safe system Node is available
- **THEN** the caller SHALL pass `opts.env.ELECTRON_RUN_AS_NODE = "1"`
- **AND** the implicit `process.execPath` fallback in `launchDashboardServer` SHALL execute the Electron binary as Node

#### Scenario: Repo-lint pins the Electron-caller contract

- **WHEN** the repo-lint test `no-electron-execpath-spawn` scans `packages/electron/src/lib/**/*.ts`
- **THEN** every call expression matching `launchDashboardServer(` SHALL either include a `nodeBin:` property in the options literal OR include `ELECTRON_RUN_AS_NODE` in the env literal passed to the same call
- **AND** the lint allowlist for `process.execPath` references inside Electron lib code SHALL contain exactly `pick-node.ts`

#### Scenario: Non-Electron callers unaffected

- **WHEN** `launchDashboardServer` is called from the bridge extension, the standalone CLI, or the restart-helper
- **THEN** the requirement does NOT apply
- **AND** those callers MAY continue to omit `opts.nodeBin` and rely on the `process.execPath` default (which in those hosts is a real Node binary)
