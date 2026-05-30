# rpc-keeper-sidecar Specification

## Purpose
Per-session RPC keeper sidecar process that owns pi's stdin pipe and outlives dashboard server restarts. The keeper sits between the dashboard server and a headless RPC pi child: it spawns pi, holds the stdin pipe, listens on a deterministic per-session UDS (Unix) or named pipe (Windows), forwards JSON-line writes verbatim to pi's stdin, and persists across dashboard server restarts so pi survives without losing its stdin. The dashboard server reconnects to existing keepers on startup via a socket-scan.
## Requirements
### Requirement: RPC keeper sidecar process per headless session
For every headless pi session spawned via `spawnPiSession({strategy: "headless"})`, the dashboard server SHALL spawn a per-session keeper process (`packages/server/src/rpc-keeper/keeper.cjs`) BEFORE spawning pi. The keeper SHALL spawn pi as its own child process with `stdio: ["pipe", logFd, logFd]`, owning pi's stdin pipe. The keeper SHALL outlive dashboard server restarts: when the dashboard server exits, the keeper SHALL continue running and pi SHALL continue running. The keeper SHALL exit with code 0 when its child pi exits.

The keeper SHALL be a CommonJS file (`.cjs`) with no TypeScript loader, jiti, or tsx dependencies — it imports only Node built-in modules (`child_process`, `net`, `fs`, `path`). This mirrors the precedent set by `packages/server/preload-fastify.cjs`.

#### Scenario: Keeper spawned before pi
- **WHEN** `spawnPiSession(cwd, {strategy: "headless"})` is invoked
- **THEN** the dashboard server SHALL spawn `node <path>/keeper.cjs <sessionId>` with the spawn env
- **AND** the keeper process SHALL spawn `pi --mode rpc` as its child
- **AND** pi's stdin SHALL be a pipe owned by the keeper process

#### Scenario: Keeper survives dashboard server restart
- **WHEN** the dashboard server exits (graceful `/api/shutdown` or SIGTERM) while a headless session is active
- **THEN** the keeper process SHALL continue running
- **AND** pi SHALL continue running with stdin still held by the keeper
- **AND** when the new dashboard server starts, it SHALL discover the keeper via the socket-scan reconnect path (see Requirement "Server reconnect to existing keepers on startup")

#### Scenario: Keeper exits when pi exits
- **WHEN** the pi child process exits (any reason: graceful shutdown, crash, signal)
- **THEN** the keeper SHALL detect the exit via `child.on("exit", ...)`
- **AND** the keeper SHALL unlink its UDS socket file and PID sidecar file
- **AND** the keeper SHALL exit with code 0

### Requirement: Per-session UDS socket / Windows named pipe
On Unix (macOS, Linux), the keeper SHALL listen on `~/.pi/dashboard/sessions/<sessionId>.rpc.sock` (Unix domain socket). On Windows, the keeper SHALL listen on `\\.\pipe\pi-rpc-<sessionId>` (named pipe). The socket / pipe path SHALL be derived deterministically from the sessionId so the dashboard server can locate it without consulting any registry.

The keeper SHALL also write its own PID to a sidecar file at `<sockPath>.pid` (Unix) or `<homedir>/.pi/dashboard/sessions/pi-rpc-<sessionId>.pid` (Windows) so the dashboard server's startup orphan-cleanup pass can detect dead-keeper-with-stale-socket and remove the socket.

#### Scenario: Unix socket path derivation
- **WHEN** keeper for session `019e0dac-d7a9-745e-b1ac-4306aa7594e2` starts on macOS or Linux
- **THEN** the keeper SHALL listen on `<homedir>/.pi/dashboard/sessions/019e0dac-d7a9-745e-b1ac-4306aa7594e2.rpc.sock`
- **AND** the keeper SHALL write its PID to `<sockPath>.pid`

#### Scenario: Windows named-pipe path derivation
- **WHEN** keeper for session `019e0dac-d7a9-745e-b1ac-4306aa7594e2` starts on Windows
- **THEN** the keeper SHALL listen on `\\.\pipe\pi-rpc-019e0dac-d7a9-745e-b1ac-4306aa7594e2`
- **AND** the keeper SHALL write its PID to `<homedir>\.pi\dashboard\sessions\pi-rpc-019e0dac-d7a9-745e-b1ac-4306aa7594e2.pid`

### Requirement: JSON-line forward protocol (fire-and-forget)
The keeper's UDS / named-pipe protocol SHALL be JSON-lines: every newline-delimited string received on the socket SHALL be appended with `\n` (if missing) and written verbatim to pi's stdin. The keeper SHALL NOT parse, validate, or modify the JSON content of incoming lines. The keeper SHALL NOT respond to writes — the socket is write-only from the dashboard server's perspective; keeper acknowledgement is implicit (write succeeds → line forwarded).

The keeper SHALL accept multiple concurrent connections on its socket. The keeper SHALL NOT serialize writes from different connections beyond what the underlying pi stdin pipe enforces.

Pi's RPC events flow back to the dashboard via the bridge extension's WebSocket connection (existing path), NOT via the keeper. The keeper SHALL NOT capture or forward pi's stdout.

#### Scenario: Server writes a prompt RPC line
- **WHEN** the dashboard server connects to the session's UDS / named pipe and writes `{"type":"prompt","message":"/ctx-stats","id":"abc"}\n`
- **THEN** the keeper SHALL write the same line (with trailing `\n` if not present) to pi's stdin
- **AND** the keeper SHALL NOT respond on the socket

#### Scenario: Keeper does not capture pi stdout
- **WHEN** pi's RPC mode emits events on its stdout
- **THEN** those events SHALL flow over the bridge WS connection (existing path)
- **AND** the keeper SHALL NOT read pi's stdout
- **AND** the keeper SHALL NOT forward pi's stdout to any UDS / named-pipe client

### Requirement: Server reconnect to existing keepers on startup
On dashboard server startup, the server SHALL scan `~/.pi/dashboard/sessions/*.rpc.sock` (Unix) or the equivalent named-pipe directory (Windows) for existing keepers. For each socket / pipe found:

1. Read the keeper PID from the corresponding `.pid` sidecar.
2. Verify the keeper PID is alive (`isProcessAlive`).
3. Verify the pi PID (looked up via `headlessPidRegistry`) is alive.
4. If both alive: register the session as RPC-dispatch-ready. The server SHALL connect to the socket lazily on first `dispatch_extension_command` for that session.
5. If keeper alive but pi dead: kill the keeper and unlink the socket + PID file.
6. If keeper dead but pi alive: kill pi, unlink files (this state is unreachable in normal operation but defensive).
7. If both dead: unlink files.

#### Scenario: Both keeper and pi alive across server restart
- **WHEN** the dashboard server starts and finds `<sid>.rpc.sock` with PID `K` (alive) and a corresponding pi PID `P` (alive in `headlessPidRegistry`)
- **THEN** the server SHALL register session `<sid>` as RPC-dispatch-ready
- **AND** the server SHALL NOT spawn a new keeper for this session

#### Scenario: Keeper alive but pi dead (orphan keeper)
- **WHEN** the dashboard server finds `<sid>.rpc.sock` with PID `K` (alive) but the corresponding pi PID `P` is dead
- **THEN** the server SHALL send SIGTERM to `K`
- **AND** the server SHALL unlink the socket file and `.pid` sidecar
- **AND** the server SHALL NOT register session `<sid>` for RPC dispatch

#### Scenario: Both keeper and pi dead (stale socket)
- **WHEN** the dashboard server finds `<sid>.rpc.sock` with `.pid` sidecar containing PID `K` that is no longer alive
- **THEN** the server SHALL unlink the socket file and `.pid` sidecar
- **AND** the server SHALL NOT register session `<sid>`

### Requirement: Keeper failure modes
The keeper SHALL handle these failure modes:

- **pi child fails to spawn** (e.g. binary missing): keeper exits non-zero with a single-line error written to its log file; UDS socket / named pipe SHALL NOT be created.
- **pi child crashes during operation**: keeper detects via `child.on("exit", ...)`, unlinks socket + PID file, exits 0.
- **UDS socket connection refused** (path collision with stale socket): keeper SHALL attempt to unlink the existing socket file before binding, retry once, then exit non-zero with a clear log message.
- **Write to pi.stdin after pi has exited**: keeper SHALL detect EPIPE / closed-stream errors, log them, and exit (the same path as "pi child crashes").
- **Out-of-order startup race** (server connects before keeper has bound socket): keeper SHALL bind socket BEFORE spawning pi; server SHALL retry connect with exponential backoff (max 3 attempts, ~500ms total) before emitting an `error` feedback.

#### Scenario: pi binary missing on keeper startup
- **WHEN** the keeper attempts to spawn `pi --mode rpc` and the binary is not found
- **THEN** the keeper SHALL log the error to its log file
- **AND** the keeper SHALL exit non-zero
- **AND** the keeper SHALL NOT create the UDS socket / named pipe

#### Scenario: Stale socket file from previous keeper crash
- **WHEN** the keeper attempts to bind its UDS socket and the path already exists
- **THEN** the keeper SHALL `unlink()` the path
- **AND** the keeper SHALL retry the bind exactly once
- **AND** if the second bind fails, the keeper SHALL exit non-zero

### Requirement: Server-resolved pi command passed to keeper

When the dashboard server spawns an RPC keeper for a headless pi session, the server SHALL resolve the `pi` binary through `ToolRegistry.resolvePiCommand()` BEFORE spawning the keeper. The resolved command (a non-empty `string[]` whose `[0]` is the absolute executable path and `[1..]` are leading argv such as `["node", "/abs/path/cli.js"]`) SHALL be forwarded to the keeper subprocess via the env var `PI_KEEPER_PI_CMD`, JSON-encoded.

When resolution fails (`resolvePiCommand()` returns null), the server SHALL NOT spawn the keeper. It SHALL return a `PI_NOT_FOUND` spawn result identical to the non-keeper headless branch.

The keeper SHALL strip `PI_KEEPER_PI_CMD` from the env it passes to pi (matching the existing handling of `PI_KEEPER_PI_ARGS`).

#### Scenario: Server resolves and forwards bundled pi (Electron launch)
- **WHEN** the dashboard server is launched from `/Applications/PI-Dashboard.app/Contents/Resources/server/` and spawns a headless RPC session
- **THEN** the server SHALL call `resolvePiCommand()` and receive an argv pointing inside `Resources/server/node_modules/`
- **AND** the server SHALL set `PI_KEEPER_PI_CMD=<JSON-encoded argv>` in the keeper's env
- **AND** the keeper SHALL spawn pi using that absolute path
- **AND** pi SHALL start successfully without relying on PATH lookup

#### Scenario: Resolver miss fails fast before keeper spawn
- **WHEN** `resolvePiCommand()` returns null at keeper-spawn time
- **THEN** the server SHALL return `{ success: false, code: "PI_NOT_FOUND", message: <message including checked locations> }`
- **AND** the keeper subprocess SHALL NOT be spawned
- **AND** no `keeper-<sessionId>.log` SHALL be created for that spawn attempt

#### Scenario: PI_KEEPER_PI_CMD stripped from pi env
- **WHEN** the keeper spawns pi with `PI_KEEPER_PI_CMD` set in its own env
- **THEN** the env passed to pi SHALL NOT contain `PI_KEEPER_PI_CMD`
- **AND** the env passed to pi SHALL NOT contain `PI_KEEPER_PI_ARGS`

### Requirement: Keeper uses resolved pi command when env var is set

The keeper SHALL, when `PI_KEEPER_PI_CMD` is set and parses to a non-empty JSON `string[]`, invoke `child_process.spawn(cmd[0], [...cmd.slice(1), ...piArgs], …)` instead of `child_process.spawn("pi", piArgs, …)`. The keeper's spawn log SHALL include the resolved executable path so resume failures can be diagnosed.

When `PI_KEEPER_PI_CMD` is unset, missing, empty, or malformed JSON, the keeper SHALL fall back to `child_process.spawn("pi", piArgs, …)` (bare PATH lookup). Malformed input SHALL be logged as `keeper: ignoring malformed PI_KEEPER_PI_CMD` and treated as unset.

#### Scenario: Keeper spawns absolute pi when env var present
- **WHEN** the keeper starts with `PI_KEEPER_PI_CMD=["/abs/path/pi"]`
- **THEN** the keeper SHALL invoke `child_process.spawn("/abs/path/pi", piArgs, …)`
- **AND** the keeper log SHALL record `spawning pi /abs/path/pi <args>`

#### Scenario: Keeper handles node+script form on Windows
- **WHEN** the keeper starts with `PI_KEEPER_PI_CMD=["node","C:\\path\\cli.js"]` and `piArgs=["--mode","rpc"]`
- **THEN** the keeper SHALL invoke `child_process.spawn("node", ["C:\\path\\cli.js","--mode","rpc"], …)`

#### Scenario: Bare pi fallback preserved for manual invocation
- **WHEN** the keeper is invoked directly (no `PI_KEEPER_PI_CMD` in env)
- **THEN** the keeper SHALL invoke `child_process.spawn("pi", piArgs, …)`
- **AND** the keeper SHALL NOT log any malformed-env-var warning

#### Scenario: Malformed env var falls back without crashing
- **WHEN** the keeper starts with `PI_KEEPER_PI_CMD="not json"` (or `[]`, or `{"foo":1}`)
- **THEN** the keeper SHALL log `keeper: ignoring malformed PI_KEEPER_PI_CMD`
- **AND** the keeper SHALL invoke `child_process.spawn("pi", piArgs, …)`
- **AND** the keeper SHALL NOT exit before the pi spawn attempt

### Requirement: Keeper SIGKILLs its pi child on shutdown
When the keeper's `shutdown()` function runs — whether triggered by `SIGTERM`, `SIGINT`, `uncaughtException`, or its own `pi-exit` / `pi-stdin-error` observer — the keeper SHALL attempt to terminate its `piChild` via `piChild.kill("SIGKILL")` before calling `process.exit(exitCode)`. The call SHALL be guarded against double-kill: it SHALL be a no-op when `piChild` is undefined, has already exited (`piChild.exitCode !== null`), or has already been signal-killed (`piChild.signalCode !== null`). Exceptions from the `.kill` call (e.g. EPERM, ESRCH on already-dead PID) SHALL be swallowed; `shutdown()` SHALL NOT throw.

This requirement is defence-in-depth alongside the registry-layer SIGKILL escalation in `headless-spawn`. The current contract — "keeper exits → pi reads stdin EOF → pi shuts down voluntarily" — assumes pi's event loop is responsive. For a pi process hung in a CPU loop, a non-cancellable native call, or a deadlocked tool, the stdin EOF is never observed and pi survives the keeper's exit as an orphaned process (reparented to init/launchd on POSIX). Explicit `SIGKILL` from the keeper bypasses the assumption.

The keeper SHALL NOT delay its own exit waiting for pi to die. The `piChild.kill("SIGKILL")` call is fire-and-forget; the keeper proceeds immediately to `process.exit(exitCode)`. SIGKILL is uninterruptible at the kernel level, so the pi process is guaranteed to terminate even after the keeper has exited.

#### Scenario: Keeper SIGTERM kills hung pi via SIGKILL
- **WHEN** the keeper receives `SIGTERM` from the dashboard server's `killBySessionId` 200 ms fallback AND its `piChild` is hung (event loop blocked, not reading stdin)
- **THEN** the keeper's `shutdown(0, "SIGTERM")` SHALL call `piChild.kill("SIGKILL")` before `process.exit(0)`
- **AND** pi SHALL die from SIGKILL even though it never observed the stdin EOF that the keeper's exit would have produced

#### Scenario: Keeper shutdown after pi already exited is a no-op SIGKILL
- **WHEN** pi exits voluntarily and the keeper's `c.on("exit", ...)` handler calls `shutdown(0, "pi-exit")`
- **THEN** the SIGKILL guard SHALL observe `piChild.exitCode !== null` and skip the `.kill` call
- **AND** no exception SHALL be thrown

#### Scenario: SIGKILL call on race-condition-dead pi swallows ESRCH
- **WHEN** the keeper enters `shutdown()` and pi exits between the `piChild.exitCode === null` guard and the `.kill("SIGKILL")` call
- **THEN** the `try / catch` SHALL absorb the resulting `ESRCH` (or platform-equivalent) error
- **AND** `shutdown()` SHALL proceed to `process.exit(exitCode)`

#### Scenario: SIGINT and uncaughtException paths also kill pi
- **WHEN** the keeper receives `SIGINT` OR an `uncaughtException` triggers `shutdown(1, "uncaughtException")`
- **THEN** the same `piChild.kill("SIGKILL")` guarded call SHALL execute before `process.exit`
- **AND** the keeper SHALL NOT leave pi orphaned regardless of which trigger entered `shutdown()`

