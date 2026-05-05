## ADDED Requirements

### Requirement: Headless spawn survives server restart (Unix)
On macOS and Linux, headless pi sessions SHALL be spawned using a `sh -c "sleep 2147483647 | pi --mode rpc"` wrapper so that the stdin pipe is internal to the process group and does not depend on the dashboard server process. When the server exits, the headless agent SHALL continue running because its stdin (provided by `sleep`) remains open. The spawn SHALL use `detached: true` and `stdio: "ignore"` so no file descriptors are shared with the server. Shell arguments SHALL be escaped using a `shellEscape` helper to prevent injection. The value `2147483647` (max 32-bit signed int) SHALL be used instead of `infinity` for compatibility with older macOS versions whose BSD `sleep` does not support `infinity`.

#### Scenario: Server exits while headless agent is running (Unix)
- **WHEN** the dashboard server exits (via `/api/shutdown` or process termination) on macOS or Linux
- **THEN** all headless pi agents SHALL continue running because their stdin pipe is internal to their own process group

#### Scenario: Headless agent reconnects after server restart
- **WHEN** the dashboard server restarts after an exit
- **THEN** the bridge extension in the headless agent SHALL reconnect via ConnectionManager backoff and re-register the session

### Requirement: Headless spawn on Windows (fallback)
On Windows (`process.platform === "win32"`), headless pi sessions SHALL be spawned directly with `spawn("pi", args, { stdio: ["pipe", "ignore", "ignore"] })` because `sh`, `sleep`, and Unix process groups are not available. The server holds the stdin pipe write end; if the server exits, the agent will terminate due to stdin EOF. This is a known limitation on Windows.

#### Scenario: Server exits while headless agent is running (Windows)
- **WHEN** the dashboard server exits on Windows
- **THEN** headless pi agents MAY terminate due to stdin EOF (known limitation)

### Requirement: Process group kill for headless agents
When terminating a headless agent (via `killBySessionId`, `killAll`, or orphan cleanup), the server SHALL send SIGTERM to the entire process group using `process.kill(-pid, "SIGTERM")` (negative PID) on Unix. On Windows, the server SHALL kill the process directly using `process.kill(pid, "SIGTERM")` since process groups are not supported.

#### Scenario: Kill headless agent by session ID (Unix)
- **WHEN** the server sends a shutdown command for a headless session on macOS or Linux
- **THEN** the server SHALL call `process.kill(-pid, "SIGTERM")` to kill the entire process group

#### Scenario: Kill headless agent by session ID (Windows)
- **WHEN** the server sends a shutdown command for a headless session on Windows
- **THEN** the server SHALL call `process.kill(pid, "SIGTERM")` to kill the process directly

#### Scenario: Kill all headless agents on server stop
- **WHEN** the server calls `killAll()` during graceful shutdown
- **THEN** each tracked entry SHALL be killed with process group kill on Unix or direct kill on Windows

### Requirement: Headless PID persistence to disk
The server SHALL persist headless process entries to `~/.pi/dashboard/headless-pids.json` using atomic writes. The file SHALL contain an array of entries with fields `pid` (number), `cwd` (string), and `spawnedAt` (ISO timestamp). Entries SHALL be written on register and removed on process exit or kill.

#### Scenario: Headless process spawned
- **WHEN** a headless pi session is spawned with PID 12345 in `/projects/app`
- **THEN** the server SHALL write an entry `{ pid: 12345, cwd: "/projects/app", spawnedAt: "..." }` to the PID file

#### Scenario: Headless process exits
- **WHEN** a tracked headless process exits
- **THEN** the server SHALL remove its entry from the PID file

#### Scenario: PID file is empty
- **WHEN** no headless processes are tracked
- **THEN** the PID file SHALL contain `{ "entries": [] }`

### Requirement: Orphan cleanup on server startup
On startup, the server SHALL read the headless PID file and check each entry. If the PID is still alive (`process.kill(pid, 0)` succeeds), the server SHALL reclaim it into the registry. If the PID is dead, the server SHALL remove the stale entry. If the PID is alive but was spawned more than 7 days ago, the server SHALL kill it (process group on Unix, direct on Windows) and remove the entry.

#### Scenario: Orphan process still alive
- **WHEN** the server starts and finds PID 12345 in the PID file and the process is still alive
- **THEN** the server SHALL add it to the headless registry for tracking

#### Scenario: Stale PID (process dead)
- **WHEN** the server starts and finds PID 12345 in the PID file but the process is not alive
- **THEN** the server SHALL remove the entry from the PID file

#### Scenario: Very old orphan killed
- **WHEN** the server starts and finds a PID spawned more than 7 days ago that is still alive
- **THEN** the server SHALL kill it (process group on Unix, direct on Windows) and remove the entry

### Requirement: Per-session stderr log path is recorded for diagnostic forwarding
The `spawnHeadlessDetached` function (Windows headless path) SHALL retain the per-session log path it opens (`~/.pi/dashboard/sessions/pi-spawn-<ts>-<rand>.log`) so that the immediate-crash branch can read its tail. The path SHALL be local to the function call (no global state) and SHALL be passed to a tail-reading helper before the function returns the failure result.

#### Scenario: log path retained across crash detection
- **WHEN** `spawnHeadlessDetached` opens the log file via `openSync` and `waitForNoCrash` subsequently reports `!ok`
- **THEN** the same `logPath` value SHALL be used to read the stderr tail attached to the returned `SpawnResult.stderr`

#### Scenario: log path retained for watchdog handoff
- **WHEN** `spawnHeadlessDetached` returns `success: true` with a `pid`
- **THEN** the `logPath` SHALL be available to callers (returned in `SpawnResult` as `logPath?: string`) so the spawn-register watchdog can read it on timeout

#### Scenario: log open fails
- **WHEN** `openSync` throws when creating the per-session log
- **THEN** the spawn SHALL still proceed and `SpawnResult.logPath` SHALL be `undefined`
