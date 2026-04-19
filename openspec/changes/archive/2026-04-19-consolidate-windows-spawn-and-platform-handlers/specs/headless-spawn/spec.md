## MODIFIED Requirements

### Requirement: Headless spawn on Windows (fallback)
On Windows (`process.platform === "win32"`), headless pi sessions SHALL be spawned via `platform/detached-spawn.ts`'s `spawnDetached` primitive with `detached: true`, `stdio: ["ignore", "ignore", logFd]` (where `logFd` is an append-mode file descriptor for `~/.pi/dashboard/sessions/<pid>.log` or an equivalent path), `windowsHide: true`, and `shell: false`. The pi command SHALL be resolved via `ToolResolver.resolvePi()` which returns `[node.exe, cli.js]` when the managed install is present, avoiding `pi.cmd` and the associated `shell: true` quoting/console-flash fragility. Because `detached: true` excludes the child from the dashboard's libuv global Job Object, the pi process SHALL survive when the dashboard server exits, matching Unix behaviour.

#### Scenario: Windows headless survives server restart
- **WHEN** the dashboard server exits on Windows AND a headless pi agent is running
- **THEN** the pi agent SHALL continue running because `detached: true` excluded it from the server's kill-on-close job
- **AND** on server restart, the bridge extension in the pi agent SHALL reconnect via ConnectionManager backoff and re-register the session

#### Scenario: Windows spawn resolves to node.exe + cli.js
- **WHEN** the Windows headless mechanism spawns pi AND the managed install is present
- **THEN** the spawn argv SHALL start with the absolute path to `node.exe` followed by the absolute path to `pi-coding-agent/dist/cli.js`
- **AND** `spawn` SHALL be invoked with `shell: false` (no cmd.exe wrapper)

#### Scenario: Windows spawn stdio is always ignore/ignore/fd
- **WHEN** the Windows headless mechanism spawns pi
- **THEN** the spawn's `stdio[0]` SHALL be `"ignore"` (no stdin pipe held by the parent)
- **AND** `stdio[1]` SHALL be `"ignore"` or a file fd
- **AND** `stdio[2]` SHALL be a file fd pointing to an append-mode log file

#### Scenario: Crash-detection window is short and tunable
- **WHEN** the Windows headless mechanism spawns pi successfully (pi does not crash)
- **THEN** the `spawnPiSession` call SHALL return within ≤ 400 ms (the primitive's default Windows crash window is 300 ms)
- **AND** the exact window SHALL be a parameter passed by `spawnPiSession`, not a constant

#### Scenario: Pi startup crash surfaces via stderr tail
- **WHEN** pi exits within the crash-detection window with a non-zero code
- **THEN** the last bytes written to the log file SHALL be read and included in the `SpawnResult.message`
- **AND** the function SHALL return `{ success: false, message: "Pi process exited immediately (code ...): <stderrTail>" }`

### Requirement: Headless spawn survives server restart (Unix)
On macOS and Linux, headless pi sessions SHALL be spawned using a `sh -c "sleep 2147483647 | pi --mode rpc"` wrapper so that the stdin pipe is internal to the process group and does not depend on the dashboard server process. When the server exits, the headless agent SHALL continue running because its stdin (provided by `sleep`) remains open. The spawn SHALL use `detached: true` and `stdio: "ignore"` so no file descriptors are shared with the server. Shell arguments SHALL be escaped using a `shellEscape` helper to prevent injection. The value `2147483647` (max 32-bit signed int) SHALL be used instead of `infinity` for compatibility with older macOS versions whose BSD `sleep` does not support `infinity`.

#### Scenario: Server exits while headless agent is running (Unix)
- **WHEN** the dashboard server exits (via `/api/shutdown` or process termination) on macOS or Linux
- **THEN** all headless pi agents SHALL continue running because their stdin pipe is internal to their own process group

#### Scenario: Headless agent reconnects after server restart (Unix and Windows)
- **WHEN** the dashboard server restarts after an exit on any platform
- **THEN** the bridge extension in the headless agent SHALL reconnect via ConnectionManager backoff and re-register the session

### Requirement: Process group kill for headless agents
When terminating a headless agent (via `killBySessionId`, `killAll`, or orphan cleanup), the server SHALL send SIGTERM to the entire process group using `process.kill(-pid, "SIGTERM")` (negative PID) on Unix. On Windows, the server SHALL kill the process directly using `process.kill(pid, "SIGTERM")` since Windows process groups are not supported at the Node API level; however, because the child was spawned with `detached: true` and `CREATE_NEW_PROCESS_GROUP`, it CAN still be signalled with `SIGBREAK` or Ctrl+Break via `GenerateConsoleCtrlEvent` if needed in the future. Direct kill remains the current default.

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
The server SHALL persist headless process entries to `~/.pi/dashboard/headless-pids.json` using atomic writes. The file SHALL contain an array of entries with fields `pid` (number), `cwd` (string), and `spawnedAt` (ISO timestamp). Entries SHALL be written on register and removed on process exit or kill. This requirement is unchanged by this change but is critical for Windows: because `detached: true` makes sessions survive server restart, the PID file SHALL be the canonical source of truth for "which sessions exist on this host."

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
On startup, the server SHALL read the headless PID file and check each entry. If the PID is still alive (`process.kill(pid, 0)` succeeds), the server SHALL reclaim it into the registry. If the PID is dead, the server SHALL remove the stale entry. If the PID is alive but was spawned more than 7 days ago, the server SHALL kill it (process group on Unix, direct on Windows) and remove the entry. After this change, Windows orphan reclamation is no longer a no-op: pi sessions that survived a server restart SHALL be reclaimable via the PID file on Windows the same way they are on Unix.

#### Scenario: Orphan process still alive (any platform)
- **WHEN** the server starts and finds PID 12345 in the PID file and the process is still alive
- **THEN** the server SHALL add it to the headless registry for tracking

#### Scenario: Windows orphan reclamation after server restart
- **WHEN** the dashboard server is killed on Windows AND a headless pi agent continues running (via `detached: true`) AND the server restarts
- **THEN** on startup the server SHALL reclaim the pi agent from the PID file
- **AND** the session SHALL reappear in the dashboard as a running session once the bridge reconnects

#### Scenario: Stale PID (process dead)
- **WHEN** the server starts and finds PID 12345 in the PID file but the process is not alive
- **THEN** the server SHALL remove the entry from the PID file

#### Scenario: Very old orphan killed
- **WHEN** the server starts and finds a PID spawned more than 7 days ago that is still alive
- **THEN** the server SHALL kill it (process group on Unix, direct on Windows) and remove the entry
