## MODIFIED Requirements

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
