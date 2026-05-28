## MODIFIED Requirements

### Requirement: Spawn pi session supports headless strategy
The `spawnPiSession` function SHALL accept an optional `strategy` parameter (`"tmux" | "headless" | "wt" | "wsl-tmux"`). When `"headless"`, `spawnPiSession` SHALL spawn the keeper sidecar (see `rpc-keeper-sidecar` capability) instead of spawning pi directly. The keeper SHALL spawn pi as its own child. The keeper path is unconditional — there is no flag to opt out.

When the strategy is `"tmux"`, `"wt"`, or `"wsl-tmux"`, `spawnPiSession` SHALL retain existing behavior unchanged. These strategies do not use the keeper because pi's stdin is owned by the user's terminal, not by the dashboard.

The `buildTmuxCommand` function SHALL continue to shell-escape `cwd` and `sessionFile` parameters using `shellEscape()`.

#### Scenario: Headless spawn uses keeper
- **WHEN** `spawnPiSession(cwd, {strategy: "headless"})` is called
- **THEN** the server SHALL spawn the keeper process via `node <path>/keeper.cjs <sessionId>` (detached)
- **AND** the keeper SHALL spawn `pi --mode rpc` as its child with `cwd` and `PI_DASHBOARD_SPAWNED=1` in env
- **AND** the keeper SHALL listen on `<homedir>/.pi/dashboard/sessions/<sessionId>.rpc.sock` (Unix) or `\\.\pipe\pi-rpc-<sessionId>` (Windows)
- **AND** no legacy `tail -f /dev/null` shell wrapper SHALL be invoked
- **AND** no direct-stdin pipe from the dashboard server to pi SHALL be opened on Windows

#### Scenario: Tmux spawn does not use keeper
- **WHEN** `spawnPiSession(cwd, {strategy: "tmux"})` is called
- **THEN** the existing tmux spawn behavior SHALL be used unchanged
- **AND** no keeper SHALL be spawned for tmux sessions

#### Scenario: Headless spawn fresh session
- **WHEN** `spawnPiSession(cwd, { strategy: "headless" })` is called with no sessionFile
- **THEN** the keeper SHALL spawn `pi --mode rpc` with `cwd` set and `PI_DASHBOARD_SPAWNED=1` in env
- **AND** `spawnPiSession` SHALL return `{ success: true, message: "...", pid: <keeper PID> }`

#### Scenario: Headless spawn with continue
- **WHEN** `spawnPiSession(cwd, { strategy: "headless", sessionFile: "...", mode: "continue" })` is called
- **THEN** the keeper SHALL spawn `pi --mode rpc --session <sessionFile>`

#### Scenario: Headless spawn with fork
- **WHEN** `spawnPiSession(cwd, { strategy: "headless", sessionFile: "...", mode: "fork" })` is called
- **THEN** the keeper SHALL spawn `pi --mode rpc --fork <sessionFile>`

#### Scenario: Tmux spawn unchanged
- **WHEN** `spawnPiSession(cwd, { strategy: "tmux" })` or `spawnPiSession(cwd)` is called
- **THEN** existing tmux spawn behavior SHALL be used unchanged

#### Scenario: Tmux command escapes cwd with special characters
- **WHEN** `buildTmuxCommand` is called with a `cwd` containing shell metacharacters (e.g., spaces, semicolons, backticks)
- **THEN** the `cwd` SHALL be shell-escaped in the generated command string to prevent command injection

#### Scenario: Tmux command escapes sessionFile with special characters
- **WHEN** `buildTmuxCommand` is called with a `sessionFile` containing shell metacharacters
- **THEN** the `sessionFile` SHALL be shell-escaped in the generated command string to prevent command injection

### Requirement: spawnHeadless returns SpawnResult with both keeper and pi PIDs
When the keeper path is used, the `SpawnResult` returned by `spawnPiSession` SHALL include the keeper PID in `pid` (matching today's contract: `pid` is the spawn-time PID that may differ from the session's bridge-registered PID). The pi PID SHALL be reported separately via the keeper's PID file once the keeper has spawned pi successfully (typically within a few hundred milliseconds).

The `headlessPidRegistry.register(pid, cwd, proc)` call site SHALL register the keeper PID at spawn time. The pi PID SHALL be linked to the session later when the bridge inside pi sends `session_register` with its actual PID, via the existing token-correlation path (see `spawn-correlation` capability).

#### Scenario: SpawnResult.pid is keeper PID at spawn time
- **WHEN** `spawnPiSession(cwd, {strategy: "headless"})` returns successfully with the keeper path
- **THEN** `result.pid` SHALL be the keeper process PID
- **AND** the keeper SHALL be tracked in `headlessPidRegistry` indexed by `cwd` and by `pid`

#### Scenario: Pi PID linked to session via token correlation
- **WHEN** the keeper's pi child starts and the bridge inside pi sends `session_register {pid: <pi PID>, spawnToken: <server-minted token>}`
- **THEN** `headlessPidRegistry` SHALL update the session entry to associate `pid: <pi PID>` with the registered sessionId
- **AND** the existing token-correlation logic SHALL handle the keeper-PID-vs-pi-PID distinction

### Requirement: Crash detection for keeper spawn
The 300ms `waitForNoCrash` window applied to direct pi spawns SHALL be applied to KEEPER spawns instead of pi spawns when the keeper path is used. If the keeper process crashes within 300ms of spawn (e.g. UDS bind failure, Node module-resolution error), `spawnPiSession` SHALL return `SpawnResult {success: false, code: "PI_CRASHED"}` with the keeper's stderr log tail.

The keeper itself SHALL apply its own crash-detection window to the pi child (300ms) and exit non-zero with a log entry if pi crashes during the window. This propagates to the dashboard server via the keeper's exit status, which the server detects via the spawn-register watchdog (existing).

#### Scenario: Keeper crashes immediately on spawn
- **WHEN** `spawnPiSession(cwd, {strategy: "headless"})` is called AND the keeper crashes within 300ms
- **THEN** `result.success` SHALL be `false`
- **AND** `result.code` SHALL be `"PI_CRASHED"` (re-using existing error code; the user-facing error message MAY clarify "keeper crashed")
- **AND** `result.stderr` SHALL contain the tail of the keeper's stderr log

#### Scenario: Pi crashes inside the keeper
- **WHEN** the keeper spawns pi successfully but pi crashes within 300ms
- **THEN** the keeper SHALL exit non-zero
- **AND** the dashboard server's spawn-register watchdog SHALL detect the keeper's exit before the bridge registers
- **AND** the user SHALL see a `spawn_failed` event with details from the keeper's log file

### Requirement: SpawnResult includes pid for headless
The `SpawnResult` interface SHALL include an optional `pid?: number` field. For headless spawns, this SHALL be set to the child process PID. For tmux spawns, this SHALL be undefined.

#### Scenario: Headless result has pid
- **WHEN** a headless spawn succeeds
- **THEN** `SpawnResult.pid` SHALL be the spawned process PID

#### Scenario: Tmux result has no pid
- **WHEN** a tmux spawn succeeds
- **THEN** `SpawnResult.pid` SHALL be undefined

### Requirement: Electron mode forces headless spawn
When the server detects it was launched by an Electron app (via `electronMode` config flag), the spawn strategy SHALL be forced to `"headless"` regardless of the configured `spawnStrategy`, and tmux detection SHALL be skipped entirely.

#### Scenario: Electron mode forces headless
- **WHEN** `electronMode` is `true` in the server config
- **THEN** `spawnPiSession` SHALL use `"headless"` strategy regardless of `spawnStrategy` config
- **AND** SHALL NOT attempt tmux detection

### Requirement: Managed install PATH augmentation
When spawning pi sessions, the process manager SHALL prepend `~/.pi-dashboard/node_modules/.bin` to the spawned process's `PATH` environment variable so managed-install pi is discoverable.

#### Scenario: Managed pi on PATH for spawned sessions
- **WHEN** `spawnPiSession` spawns a process
- **THEN** the spawned process's `PATH` SHALL include `~/.pi-dashboard/node_modules/.bin`

### Requirement: SpawnResult includes failure classification code
The `SpawnResult` interface SHALL include an optional `code?: SpawnFailureCode` field. Every code path inside `spawnPiSession` (and its helpers `spawnTmux`, `spawnWt`, `spawnWslTmux`, `spawnHeadless`, `spawnHeadlessDetached`) that returns `{ success: false, ... }` SHALL set `code` to one of: `"DIR_MISSING"`, `"PI_NOT_FOUND"`, `"WIN_PI_CMD_ONLY"`, `"WT_MISSING"`, `"TMUX_MISSING"`, `"PI_CRASHED"`, `"SPAWN_ERRNO"`. Successful spawns SHALL leave `code` undefined.

#### Scenario: cwd does not exist
- **WHEN** `spawnPiSession(cwd, opts)` is called with a non-existent `cwd`
- **THEN** the result SHALL be `{ success: false, code: "DIR_MISSING", message: <human string> }`

#### Scenario: pi binary cannot be resolved
- **WHEN** `spawnPiSession` calls `resolvePiCommand()` and receives `null`
- **THEN** the result SHALL be `{ success: false, code: "PI_NOT_FOUND", message: <human string> }`

#### Scenario: Windows headless finds only pi.cmd
- **WHEN** `spawnHeadlessDetached` receives a `bin` ending in `.cmd` or `.bat`
- **THEN** the result SHALL be `{ success: false, code: "WIN_PI_CMD_ONLY", message: <human string mentioning wizard> }`

#### Scenario: Windows Terminal not installed
- **WHEN** `spawnWt` calls `resolver.which("wt")` and receives `null`
- **THEN** the result SHALL be `{ success: false, code: "WT_MISSING", message: <human string> }`

#### Scenario: tmux mechanism chosen but tmux missing
- **WHEN** `spawnTmux` `execSync` fails because `tmux` is not on PATH
- **THEN** the result SHALL be `{ success: false, code: "TMUX_MISSING", message: <human string> }`

#### Scenario: pi process crashes inside detection window
- **WHEN** `waitForNoCrash` reports `!ok` after spawning pi
- **THEN** the result SHALL be `{ success: false, code: "PI_CRASHED", message: <human string with exit code> }`

#### Scenario: detached spawn primitive errors
- **WHEN** `spawnDetached` returns `!ok` with an `error` string (ENOENT, EACCES, etc.)
- **THEN** the result SHALL be `{ success: false, code: "SPAWN_ERRNO", message: <human string including underlying error> }`

#### Scenario: successful spawn omits code
- **WHEN** `spawnPiSession` returns `{ success: true, ... }`
- **THEN** the result `code` field SHALL be `undefined`

### Requirement: SpawnResult includes stderr tail on Windows headless crash
The `SpawnResult` interface SHALL include an optional `stderr?: string` field. When `spawnHeadlessDetached` returns due to `waitForNoCrash` reporting an immediate exit AND the per-session log file at `~/.pi/dashboard/sessions/pi-spawn-<ts>-<rand>.log` exists, the function SHALL read the last 4096 bytes of that file, strip leading UTF-8 continuation bytes, and assign the resulting string to `result.stderr`. Read errors SHALL be swallowed (stderr left undefined). Other failure paths and other platforms SHALL leave `stderr` undefined in v1.

#### Scenario: Windows headless crash with non-empty log
- **WHEN** `spawnHeadlessDetached` reports `PI_CRASHED` and the per-session log file contains pi stderr output
- **THEN** `result.stderr` SHALL be a string containing the last 4096 bytes (or full file if smaller) of that log, with leading UTF-8 continuation bytes stripped

#### Scenario: Windows headless crash with empty log
- **WHEN** `spawnHeadlessDetached` reports `PI_CRASHED` and the per-session log file is empty or missing
- **THEN** `result.stderr` SHALL be `undefined`

#### Scenario: log read throws
- **WHEN** the log file exists but `fs.readSync` throws (permission, disk error)
- **THEN** the failure SHALL be swallowed and `result.stderr` SHALL be `undefined`

#### Scenario: non-Windows headless crash
- **WHEN** the Unix headless wrapper reports a spawn failure
- **THEN** `result.stderr` SHALL be `undefined` (Unix log capture is out of scope for v1)
