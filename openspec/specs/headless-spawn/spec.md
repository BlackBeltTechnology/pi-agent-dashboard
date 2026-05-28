## ADDED Requirements

### Requirement: Headless spawn survives server restart (Unix)
On macOS and Linux, headless pi sessions SHALL be spawned via the keeper sidecar (see `rpc-keeper-sidecar` capability). The dashboard server SHALL spawn the keeper as a detached child process; the keeper SHALL spawn pi with `stdio: ["pipe", logFd, logFd]` and own pi's stdin pipe.

The keeper SHALL outlive the dashboard server. When the dashboard server exits, the keeper SHALL continue running with pi attached. When the new dashboard server starts, it SHALL discover the keeper via the socket-scan reconnect path (see `rpc-keeper-sidecar` Requirement "Server reconnect to existing keepers on startup") and resume RPC dispatch routing.

The keeper path is unconditional. There is no feature flag and no legacy non-keeper fallback. The previous `sh -c "tail -f /dev/null | pi --mode rpc"` shell wrapper is retired. Durability is provided by the keeper. The `headlessPidRegistry` SHALL track BOTH the keeper PID and the pi PID per session; the existing `byCwd / byPid / byToken` indexing handles the spawn-PID-vs-session-PID correlation as today (see `spawn-correlation` capability).

#### Scenario: Server exits while headless agent is running (Unix)
- **WHEN** the dashboard server exits (graceful `/api/shutdown` or SIGTERM) on macOS or Linux while a headless session is active
- **THEN** the session's keeper process SHALL continue running
- **AND** pi SHALL continue running with stdin still held by the keeper
- **AND** the bridge extension inside pi SHALL continue forwarding events over WebSocket (with reconnection backoff)

#### Scenario: New server reconnects to existing keeper on startup
- **WHEN** the new dashboard server starts and finds a `<sessionId>.rpc.sock` whose keeper PID and pi PID are both alive
- **THEN** the server SHALL register the session as RPC-dispatch-ready
- **AND** the server SHALL NOT spawn a new keeper for this session
- **AND** the server SHALL NOT kill the existing keeper or pi

#### Scenario: No legacy fallback when keeper spawn fails
- **WHEN** the keeper spawn itself fails (e.g. `node <path>/keeper.cjs` ENOENT, UDS bind error)
- **THEN** `spawnPiSession` SHALL return `{ success: false, code: "PI_CRASHED", ... }`
- **AND** no fallback to a legacy `tail -f /dev/null` wrapper SHALL be attempted

### Requirement: Headless spawn on Windows uses keeper for durability parity
On Windows, headless pi sessions SHALL be spawned via the same keeper sidecar pattern as Unix. The keeper SHALL listen on a Windows named pipe (`\\.\pipe\pi-rpc-<sessionId>`) and own pi's stdin via `stdio: ["pipe", logFd, logFd]`. The keeper path is unconditional on Windows — there is no fallback to direct-stdin piping from the dashboard server to pi.

This replaces the previous Windows behavior where the dashboard server piped pi's stdin directly, which meant pi died with the dashboard server on every restart. With the keeper as the only path, Windows now matches Unix unconditionally: pi survives across dashboard server restarts.

#### Scenario: Server exits while headless agent is running (Windows)
- **WHEN** the dashboard server exits on Windows while a headless session is active
- **THEN** the session's keeper process SHALL continue running
- **AND** pi SHALL continue running with stdin held by the keeper
- **AND** when the new server starts, it SHALL reconnect via the named-pipe scan

#### Scenario: No direct-stdin pipe from dashboard server to pi
- **WHEN** any headless session is spawned on Windows
- **THEN** the dashboard server SHALL NOT open a stdin pipe directly to the pi child
- **AND** all stdin writes destined for pi SHALL be routed through the keeper's named pipe

### Requirement: Headless spawn cleanup tracks keeper PIDs
The `headlessPidRegistry` SHALL track keeper PIDs alongside pi PIDs per session. The registry's existing `cleanupOrphans` pass SHALL be extended to:

1. Scan `~/.pi/dashboard/sessions/*.rpc.sock` (Unix) or named-pipe directory (Windows) for keepers.
2. For each keeper found: verify its PID is alive (via `isProcessAlive`) and its corresponding pi PID is alive.
3. Kill orphan keepers (alive keeper, dead pi) and unlink their socket + PID sidecar files.
4. Remove stale socket files where the keeper PID is dead.

The cleanup SHALL run on dashboard server startup BEFORE any new keepers are spawned.

#### Scenario: Cleanup removes orphan keeper after pi crash
- **GIVEN** a keeper for session `<sid>` is alive but its pi child has crashed
- **WHEN** the dashboard server starts
- **THEN** the cleanup pass SHALL send SIGTERM to the keeper PID
- **AND** SHALL unlink `<sid>.rpc.sock` and `<sid>.rpc.sock.pid`
- **AND** the session SHALL not be registered as RPC-dispatch-ready

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

### Requirement: `PI_DASHBOARD_SPAWN_TOKEN` env-var injected on every spawn
For every invocation of `spawnPiSession()` — regardless of strategy (`tmux`, `wt`, `wsl-tmux`, `headless`) and regardless of platform — the server SHALL inject `PI_DASHBOARD_SPAWN_TOKEN` (a freshly-minted UUIDv4) into the spawned process's environment via `buildSpawnEnv`. The injection SHALL be the only mechanism by which the spawn token reaches the spawned pi process; the token SHALL NOT be passed via argv, the session JSONL file, or any other channel.

The `buildSpawnEnv(baseEnv, opts?)` function SHALL accept an optional `spawnToken: string` argument and SHALL set `result.PI_DASHBOARD_SPAWN_TOKEN = spawnToken` when provided. The existing `prependManagedNodeToPath` and other env-shaping behaviors SHALL be preserved unchanged.

#### Scenario: Headless spawn injects token
- **WHEN** `spawnPiSession(cwd, { strategy: "headless", spawnToken: "tok_h" })` is called on Linux or macOS
- **THEN** the spawned `sh -c "sleep ... | pi --mode rpc"` process SHALL have `PI_DASHBOARD_SPAWN_TOKEN=tok_h` in its environment
- **AND** the bridge running inside that pi process SHALL be able to read the token via `process.env.PI_DASHBOARD_SPAWN_TOKEN`

#### Scenario: Tmux spawn injects token
- **WHEN** `spawnPiSession(cwd, { strategy: "tmux", spawnToken: "tok_t" })` is called
- **THEN** the spawned tmux pane's pi process SHALL have `PI_DASHBOARD_SPAWN_TOKEN=tok_t` in its environment
- **AND** the bridge running inside that pi process SHALL be able to read the token

#### Scenario: Windows headless injects token
- **WHEN** `spawnPiSession(cwd, { strategy: "headless", spawnToken: "tok_w" })` is called on Windows
- **THEN** the directly-spawned `pi` process SHALL have `PI_DASHBOARD_SPAWN_TOKEN=tok_w` in its environment

#### Scenario: WT and WSL-tmux strategies inject token
- **WHEN** `spawnPiSession(cwd, { strategy: "wt", spawnToken: "tok_x" })` or `{ strategy: "wsl-tmux", spawnToken: "tok_y" }` is called
- **THEN** the spawned terminal-hosted pi process SHALL have `PI_DASHBOARD_SPAWN_TOKEN` in its environment

#### Scenario: Existing env vars preserved
- **WHEN** the dashboard server's environment contains `PATH`, `HOME`, `PI_DASHBOARD_URL`, etc.
- **THEN** the spawned process SHALL receive all of those vars unchanged in addition to `PI_DASHBOARD_SPAWN_TOKEN`

#### Scenario: Token not echoed to argv
- **WHEN** the server inspects the spawned process command-line via `ps` or equivalent
- **THEN** the spawn token SHALL NOT appear as an argv element

#### Scenario: Spawn without token (auto-resume disabled mode, future)
- **WHEN** `spawnPiSession` is called without a `spawnToken` argument (legacy callers)
- **THEN** the spawn SHALL proceed and `PI_DASHBOARD_SPAWN_TOKEN` SHALL NOT be set in the spawned process's env
- **AND** the bridge SHALL omit `spawnToken` from `session_register`, falling through to pid-link or cwd-FIFO at the server side
