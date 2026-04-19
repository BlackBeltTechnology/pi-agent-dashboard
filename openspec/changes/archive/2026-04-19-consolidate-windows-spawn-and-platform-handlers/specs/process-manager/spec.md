## MODIFIED Requirements

### Requirement: Spawn pi session supports headless strategy
The `spawnPiSession` function SHALL accept an optional `strategy` parameter (`"tmux" | "headless"`) matching the `SpawnStrategy` config type. The function SHALL delegate dispatch to `selectMechanism` (from `platform/spawn-mechanism.ts`), passing `platform`, `userStrategy`, `electronMode`, and `available: { tmux, wt, wslTmux }`. The function SHALL resolve tool availability via `ToolRegistry` (`pi`, `tmux`, `wt`, and a WSL-tmux probe). The function SHALL invoke exactly one mechanism per call. Every mechanism branch SHALL forward `SessionOptions.sessionFile` and `SessionOptions.mode` uniformly; no branch may drop them.

The `buildTmuxCommand` function SHALL shell-escape `cwd` and `sessionFile` parameters before interpolating them into the command string. The existing `shellEscape()` helper SHALL be reused for this purpose.

#### Scenario: Headless spawn fresh session
- **WHEN** `spawnPiSession(cwd, { strategy: "headless" })` is called
- **THEN** it SHALL spawn `pi --mode rpc` with `cwd` set and `PI_DASHBOARD_SPAWNED=1` in env
- **AND** return `{ success: true, message: "...", pid: <number> }`

#### Scenario: Headless spawn with continue
- **WHEN** `spawnPiSession(cwd, { strategy: "headless", sessionFile: "...", mode: "continue" })` is called
- **THEN** it SHALL spawn `pi --mode rpc --session <sessionFile>`

#### Scenario: Headless spawn with fork
- **WHEN** `spawnPiSession(cwd, { strategy: "headless", sessionFile: "...", mode: "fork" })` is called
- **THEN** it SHALL spawn `pi --mode rpc --fork <sessionFile>`

#### Scenario: Tmux spawn unchanged on Unix
- **WHEN** `spawnPiSession(cwd, { strategy: "tmux" })` or `spawnPiSession(cwd)` is called on `linux` or `darwin` with `tmux` available
- **THEN** existing tmux spawn behavior SHALL be used unchanged (via the `"tmux"` mechanism branch)

#### Scenario: Windows with wt spawns via Windows Terminal
- **WHEN** `spawnPiSession(cwd, { strategy: "tmux" })` is called on `win32` with `wt` available
- **THEN** it SHALL spawn a new tab in Windows Terminal (`wt -w 0 new-tab -d <cwd> --title ... -- <piArgv>`)
- **AND** `sessionFile`/`mode` SHALL be appended to `piArgv` when provided

#### Scenario: Windows fork with wt includes --fork
- **WHEN** `spawnPiSession(cwd, { strategy: "tmux", sessionFile: "C:\\x.jsonl", mode: "fork" })` is called on `win32` with wt available
- **THEN** the wt argv SHALL contain `"--fork"` followed by `"C:\\x.jsonl"` after the `--` sentinel

#### Scenario: Windows without wt or WSL tmux falls through to headless
- **WHEN** `spawnPiSession(cwd, { strategy: "tmux", ... })` is called on `win32` with neither `wt` nor WSL tmux available
- **THEN** the headless mechanism SHALL be used
- **AND** `sessionFile`/`mode` SHALL be forwarded to pi's argv as `--session` or `--fork`

#### Scenario: Windows fork outside Electron works uniformly
- **WHEN** `spawnPiSession(cwd, { sessionFile, mode: "fork" })` is called on `win32` from a terminal-launched dashboard (no `electronMode`)
- **THEN** pi SHALL start with `--fork <sessionFile>` in its argv
- **AND** the new pi process SHALL read the forked session file and start a new session based on it (no silent downgrade to a fresh session)

#### Scenario: Tmux command escapes cwd with special characters
- **WHEN** `buildTmuxCommand` is called with a `cwd` containing shell metacharacters (e.g., spaces, semicolons, backticks)
- **THEN** the `cwd` SHALL be shell-escaped in the generated command string to prevent command injection

#### Scenario: Tmux command escapes sessionFile with special characters
- **WHEN** `buildTmuxCommand` is called with a `sessionFile` containing shell metacharacters
- **THEN** the `sessionFile` SHALL be shell-escaped in the generated command string to prevent command injection

### Requirement: SpawnResult includes pid for headless
The `SpawnResult` interface SHALL include an optional `pid?: number` field. For headless and `wt`-mechanism spawns, this SHALL be set to the spawned child PID (the direct child of the dashboard server process — for `wt`, that is `wt.exe`, which exits immediately, so downstream consumers SHALL NOT assume this PID identifies the long-lived pi process). For `tmux` and `wsl-tmux` spawns, this SHALL be undefined.

#### Scenario: Headless result has pid
- **WHEN** a headless spawn succeeds
- **THEN** `SpawnResult.pid` SHALL be the spawned process PID

#### Scenario: Tmux result has no pid
- **WHEN** a tmux spawn succeeds
- **THEN** `SpawnResult.pid` SHALL be undefined

#### Scenario: wt result pid refers to wt.exe
- **WHEN** a `wt` mechanism spawn succeeds on Windows
- **THEN** `SpawnResult.pid` SHALL be `wt.exe`'s PID (short-lived; wt exits after opening the tab)

### Requirement: Electron mode forces headless spawn
When the server detects it was launched by an Electron app (via `electronMode` config flag), the spawn strategy SHALL be forced to `"headless"` regardless of the configured `spawnStrategy`, and tmux/wt/wsl-tmux detection SHALL be skipped entirely by `selectMechanism`.

#### Scenario: Electron mode forces headless
- **WHEN** `electronMode` is `true` in the server config
- **THEN** `selectMechanism` SHALL return `"headless"` regardless of `userStrategy` or tool availability
- **AND** `spawnPiSession` SHALL NOT attempt tmux/wt/wsl detection

### Requirement: Managed install PATH augmentation
When spawning pi sessions, the process manager SHALL prepend `~/.pi-dashboard/node_modules/.bin` to the spawned process's `PATH` environment variable so managed-install pi is discoverable. This augmentation SHALL be applied to every mechanism branch (tmux, wt, wsl-tmux, headless).

#### Scenario: Managed pi on PATH for spawned sessions
- **WHEN** `spawnPiSession` spawns a process via any mechanism
- **THEN** the spawned process's `PATH` SHALL include `~/.pi-dashboard/node_modules/.bin`

### Requirement: Dispatch uses injectable resolver for testability
The process manager SHALL accept a `ToolResolver` instance as an injectable dependency (either constructor argument for a class form, or module-level setter for the function form) so that dispatch tests can assert "if `wt` is available, `selectMechanism` returns `'wt'`" without spawning real subprocesses or mutating `process.platform`. Production code SHALL pass a single shared resolver at startup.

#### Scenario: Test injects fake resolver
- **WHEN** a unit test injects a fake `ToolResolver` whose `resolvePi()` returns a known argv AND `which("wt")` returns a Windows Terminal path
- **THEN** `spawnPiSession` SHALL use the fake resolver's outputs
- **AND** `selectMechanism` SHALL be called with `available.wt === true`

### Requirement: No direct platform branches outside platform/
The `process-manager.ts` file SHALL NOT contain any `process.platform === "win32"` (or `=== "linux"` / `=== "darwin"`) branches. All platform-aware behaviour SHALL be delegated to `platform/detached-spawn.ts`, `platform/spawn-mechanism.ts`, or `platform/binary-lookup.ts`. The file SHALL be clean of direct platform branches by the time this change lands and SHALL be enforced by the `no-direct-platform-branch` invariant test.

#### Scenario: Guard test passes for process-manager
- **WHEN** the `no-direct-platform-branch.test.ts` invariant runs
- **THEN** it SHALL NOT include `process-manager.ts` in its allowlist
- **AND** the file SHALL have zero `process.platform === "..."` matches outside the module's doc comments
