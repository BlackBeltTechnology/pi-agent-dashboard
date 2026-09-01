# rpc-keeper-sidecar Specification

## Purpose
Per-session RPC keeper sidecar process that owns pi's stdin pipe and outlives dashboard server restarts. The keeper sits between the dashboard server and a headless RPC pi child: it spawns pi, holds the stdin pipe, listens on a deterministic per-session UDS (Unix) or named pipe (Windows), forwards JSON-line writes verbatim to pi's stdin, and persists across dashboard server restarts so pi survives without losing its stdin. The dashboard server reconnects to existing keepers on startup via a socket-scan.

## Requirements

### Requirement: RPC keeper sidecar process per headless session
For every headless pi session spawned via `spawnPiSession({strategy: "headless"})`, the dashboard server SHALL spawn a per-session keeper process (`packages/server/src/rpc-keeper/keeper.cjs`) BEFORE spawning pi. The keeper SHALL spawn pi as its own child process, owning pi's stdin pipe. The keeper SHALL select pi's stdout/stderr sink based on the `PI_KEEPER_CAPTURE_PI_OUTPUT` env var (set by `KeeperManager` from `config.keeperLog.capturePiOutput`): when capture is enabled, the keeper SHALL use `stdio: ["pipe", logFd, logFd]` so pi's stdout/stderr are appended to `keeper-<sessionId>.log`; when capture is disabled (the default), the keeper SHALL use `stdio: ["pipe", "ignore", "ignore"]` so pi's stdout/stderr are discarded. Regardless of the flag, the keeper SHALL write its own lifecycle log lines (`keeper starting`, `spawning pi`, `pi exited code=…`, errors) to `keeper-<sessionId>.log` via its internal `log()` writer. The keeper SHALL outlive dashboard server restarts: when the dashboard server exits, the keeper SHALL continue running and pi SHALL continue running. The keeper SHALL exit with code 0 when its child pi exits.

The keeper SHALL be a CommonJS file (`.cjs`) with no TypeScript loader, jiti, or tsx dependencies — it imports only Node built-in modules (`child_process`, `net`, `fs`, `path`). This mirrors the precedent set by `packages/server/preload-fastify.cjs`.

#### Scenario: Keeper spawned before pi
- **WHEN** `spawnPiSession(cwd, {strategy: "headless"})` is invoked
- **THEN** the dashboard server SHALL spawn `node <path>/keeper.cjs <sessionId>` with the spawn env
- **AND** the keeper process SHALL spawn `pi --mode rpc` as its child
- **AND** pi's stdin SHALL be a pipe owned by the keeper process

#### Scenario: Capture disabled by default discards pi output
- **WHEN** the keeper starts and `PI_KEEPER_CAPTURE_PI_OUTPUT` is unset, empty, or not `"1"`
- **THEN** the keeper SHALL spawn pi with `stdio: ["pipe", "ignore", "ignore"]`
- **AND** pi's stdout/stderr SHALL NOT be written to `keeper-<sessionId>.log`
- **AND** the keeper's own lifecycle log lines SHALL still be written to `keeper-<sessionId>.log`

#### Scenario: Capture enabled archives pi output
- **WHEN** the keeper starts and `PI_KEEPER_CAPTURE_PI_OUTPUT` is `"1"`
- **THEN** the keeper SHALL spawn pi with `stdio: ["pipe", logFd, logFd]`
- **AND** pi's stdout/stderr SHALL be appended to `keeper-<sessionId>.log`

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
On Unix (macOS, Linux), the keeper SHALL listen on
`<base>/.pi/dashboard/sessions/<sessionId>.rpc.sock` (Unix domain socket), where
`<base>` is the `PI_DASHBOARD_HOME` environment variable when it is set and
non-empty, and `os.homedir()` otherwise (the default — unchanged). On Windows,
the keeper SHALL listen on `\\.\pipe\pi-rpc-<sessionId>` (named pipe). The socket
/ pipe path SHALL be derived deterministically from the base and the sessionId so
the dashboard server can locate it without consulting any registry. The dashboard
server SHALL derive the same base for both spawning keepers and the startup
socket-scan reconnect, and SHALL forward `PI_DASHBOARD_HOME` into the keeper
subprocess environment so the server and the keeper agree on the directory.

The keeper SHALL also write its own PID to a sidecar file at `<sockPath>.pid`
(Unix) or `<base>/.pi/dashboard/sessions/pi-rpc-<sessionId>.pid` (Windows) so the
dashboard server's startup orphan-cleanup pass can detect dead-keeper-with-stale-socket
and remove the socket.

#### Scenario: Unix socket path derivation (default base)
- **WHEN** keeper for session `019e0dac-d7a9-745e-b1ac-4306aa7594e2` starts on macOS or Linux with `PI_DASHBOARD_HOME` unset
- **THEN** the keeper SHALL listen on `<homedir>/.pi/dashboard/sessions/019e0dac-d7a9-745e-b1ac-4306aa7594e2.rpc.sock`
- **AND** the keeper SHALL write its PID to `<sockPath>.pid`

#### Scenario: Unix socket path derivation (PI_DASHBOARD_HOME override)
- **WHEN** keeper for session `019e0dac-d7a9-745e-b1ac-4306aa7594e2` starts on macOS or Linux and `PI_DASHBOARD_HOME` is `/home/u/.ibdev`
- **THEN** the keeper SHALL listen on `/home/u/.ibdev/.pi/dashboard/sessions/019e0dac-d7a9-745e-b1ac-4306aa7594e2.rpc.sock`
- **AND** the dashboard server's startup reconnect scan SHALL scan `/home/u/.ibdev/.pi/dashboard/sessions`

#### Scenario: Windows named-pipe path derivation
- **WHEN** keeper for session `019e0dac-d7a9-745e-b1ac-4306aa7594e2` starts on Windows
- **THEN** the keeper SHALL listen on `\\.\pipe\pi-rpc-019e0dac-d7a9-745e-b1ac-4306aa7594e2`
- **AND** the keeper SHALL write its PID to `<base>\.pi\dashboard\sessions\pi-rpc-019e0dac-d7a9-745e-b1ac-4306aa7594e2.pid`

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

On dashboard server startup, the server SHALL scan `~/.pi/dashboard/sessions/*.rpc.sock`
(Unix) or the equivalent named-pipe directory (Windows) for existing keepers. For each
socket / pipe found:

1. Read the keeper PID from the corresponding `.pid` sidecar.
2. Verify the keeper PID is alive (`isProcessAlive`).
3. Verify the pi PID (read from the keeper's pi-PID sidecar) is alive.
4. If both alive: register the session as RPC-dispatch-ready. The server SHALL connect to
   the socket lazily on first `dispatch_extension_command` for that session.
5. If keeper alive but pi dead: kill the keeper and unlink the socket + PID files.
6. If keeper dead but pi alive: kill pi, unlink files (this state is unreachable in normal
   operation but defensive).
7. If both dead: unlink files.

Step 3 SHALL be a real liveness check. It is currently inert because the keeper manager is
constructed without an `isPiAliveForSession` probe, so the default `() => true` is used. The
probe SHALL read the pi-PID sidecar from the sessions directory and test that PID for liveness,
and SHALL be the keeper manager's default rather than an injected dependency, because it must
answer for discovered keepers that have **no** reclaimed registry entry, which the registry cannot
speak for.

The probe SHALL return "alive" when the sidecar is absent or unparseable, and "dead" only for a
present, parseable PID that is not live. Step 3 gates a destructive branch (kill the keeper,
unlink its files); a keeper whose sidecar write failed, or which predates this change, is healthy
and SHALL NOT be terminated on the basis of a missing file.

During the scan the server SHALL populate the registry entry's `piPid` from the pi-PID sidecar
when the entry has none, SHALL leave an existing `piPid` untouched, and SHALL leave the entry
unchanged when the sidecar is absent or unparseable. The server SHALL NOT derive pi's PID from a
process-tree enumeration, a cwd, or a process name.

To make that possible, the discovery result for each keeper SHALL carry the pi PID read from the
sidecar alongside the existing session id, keeper PID, and socket path. The existing consumer
SHALL be restructured so this value is applied to entries that already carry a keeper PID:
today it acts only on entries whose keeper PID is unset, which excludes every reclaimed entry —
the primary population — and would otherwise leave this requirement inert.

The session id carried by a discovery result is the keeper's **transport** id, not pi's session
UUID. Consumers SHALL associate a result with a registry entry via the keeper PID, and SHALL NOT
assume the two id spaces are interchangeable.

#### Scenario: Missing sidecar does not terminate a healthy keeper

- **GIVEN** a live keeper with a live pi and no pi-PID sidecar
- **WHEN** the startup scan evaluates step 3 for that session
- **THEN** the scan SHALL treat pi as alive
- **AND** the keeper SHALL NOT be sent SIGTERM
- **AND** the socket and PID sidecar SHALL NOT be unlinked

#### Scenario: Discovery fills piPid on a reclaimed entry

- **GIVEN** a reclaimed registry entry that already carries a keeper PID and has no `piPid`
- **AND** a readable pi-PID sidecar naming a live PID for that keeper
- **WHEN** the startup scan runs
- **THEN** the server SHALL record that PID on the entry

The server SHALL emit a diagnostic per discovered keeper recording whether the pi PID was
recorded, left unchanged, or unavailable.

#### Scenario: Both keeper and pi alive across server restart

- **WHEN** the dashboard server starts and finds `<sid>.rpc.sock` with PID `K` (alive) and a pi-PID sidecar naming a live PID `P`
- **THEN** the server SHALL register session `<sid>` as RPC-dispatch-ready
- **AND** the server SHALL NOT spawn a new keeper for this session

#### Scenario: Keeper alive but pi dead (orphan keeper)

- **WHEN** the dashboard server finds `<sid>.rpc.sock` with PID `K` (alive) but the pi PID for that session is dead
- **THEN** the server SHALL send SIGTERM to `K`
- **AND** the server SHALL unlink the socket file and both PID sidecars
- **AND** the server SHALL NOT register session `<sid>` for RPC dispatch

#### Scenario: Both keeper and pi dead (stale socket)

- **WHEN** the dashboard server finds `<sid>.rpc.sock` with a `.pid` sidecar containing PID `K` that is no longer alive
- **THEN** the server SHALL unlink the socket file and both PID sidecars
- **AND** the server SHALL NOT register session `<sid>`

#### Scenario: Missing pi-PID sidecar degrades to today's behaviour

- **GIVEN** a live keeper spawned before this change, with no pi-PID sidecar
- **WHEN** discovery runs
- **THEN** the server SHALL leave the entry's `piPid` unchanged
- **AND** the diagnostic SHALL record the pi PID as unavailable
- **AND** the session SHALL otherwise be handled exactly as before this change

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

### Requirement: Keeper SHALL record pi's PID in a sidecar after spawning pi

The keeper writes its own PID sidecar before spawning pi, so pi's PID cannot be present in that
file. The keeper SHALL therefore write pi's PID to a **separate** sidecar — `<sockPath>.pi-pid`
on Unix, and `pi-rpc-<sessionId>.pi-pid` in the sessions directory on Windows — immediately after
`spawnPi()` returns a live child and before logging `keeper ready`.

The filename SHALL NOT end in `.pid`. The existing Windows keeper-sidecar scan matches
`^pi-rpc-(.+)\.pid$` with a greedy group, so a name such as `pi-rpc-<sessionId>.pi.pid` would be
matched by it and misread as a keeper sidecar — producing a phantom session whose id is
`<sessionId>.pi` and whose keeper PID is actually pi's PID.

The file SHALL contain pi's PID as a bare decimal integer, matching the existing sidecar's
format. The keeper's own PID sidecar SHALL be left byte-identical to its current form, so every
existing reader — including the server's startup orphan-cleanup — is unaffected.

Presence of the file is itself the signal: absent means pi's PID is unknown; present means it was
written after a successful spawn.

If the write fails, the keeper SHALL log the failure and continue running. Pi is alive at that
point and SHALL NOT be torn down because a diagnostic file could not be written.

The keeper SHALL unlink the pi-PID sidecar in the same `shutdown()` path that unlinks its socket
and its own PID sidecar, so a terminated keeper never leaves a file naming a process it no longer
owns.

This requirement adds only `fs` writes and unlinks to `keeper.cjs`; it introduces no module
import, so the keeper remains a CommonJS file depending solely on Node built-ins.

#### Scenario: Pi PID sidecar written after a successful spawn

- **WHEN** the keeper spawns pi successfully
- **THEN** the keeper SHALL write pi's PID as a decimal integer to the pi-PID sidecar
- **AND** the keeper SHALL do so before logging `keeper ready`
- **AND** the keeper's own PID sidecar SHALL be unchanged in content and format

#### Scenario: Failed sidecar write does not kill a live pi

- **GIVEN** pi has spawned successfully
- **WHEN** writing the pi-PID sidecar throws
- **THEN** the keeper SHALL log the error
- **AND** the keeper SHALL continue running with pi alive

#### Scenario: Pi PID sidecar removed on keeper shutdown

- **WHEN** the keeper's `shutdown()` runs for any reason
- **THEN** the keeper SHALL unlink the pi-PID sidecar alongside the socket and its own PID sidecar

#### Scenario: No pi-PID sidecar is written when the spawn fails

- **WHEN** the keeper's pi spawn fails
- **THEN** the keeper SHALL NOT create a pi-PID sidecar

#### Scenario: Pi-PID sidecar is never mistaken for a keeper sidecar

- **GIVEN** a sessions directory containing both a keeper PID sidecar and a pi-PID sidecar for the same session
- **WHEN** the startup keeper scan enumerates that directory on either platform
- **THEN** the scan SHALL treat only the keeper PID sidecar as a keeper record
- **AND** the scan SHALL NOT emit a discovered keeper whose session id is derived from a pi-PID sidecar filename

### Requirement: Keeper log SHALL be size-bounded by in-place truncation

The keeper SHALL bound the growth of `keeper-<sessionId>.log`. When the log reaches `keeperLog.maxBytes` (default 128 MiB), the keeper SHALL truncate it in place to zero length and SHALL retain no rotated generation.

Truncation SHALL be attempted on the descriptor first (`fs.ftruncateSync(logFd, 0)`) and, if that throws, by path (`fs.truncateSync(logPath, 0)`) as a fallback. The descriptor is opened `O_APPEND` and Windows may refuse a descriptor truncation on such a handle; the fallback opens its own handle against the same inode. Before falling back, the keeper SHALL confirm that `logPath` still resolves to the same inode as `logFd`, so a swapped or replaced path cannot be truncated in place of the file actually being measured.

Rotation SHALL NOT rename, unlink, reopen, or copy the live log while the keeper is running. The descriptor `logFd` is handed to the pi child as `stdio: ["pipe", logFd, logFd]` when `PI_KEEPER_CAPTURE_PI_OUTPUT` is `"1"`; renaming or reopening leaves the child writing into the detached inode, so growth would continue invisibly. Copying the file before truncation is likewise excluded: it blocks the keeper's event loop for hundreds of milliseconds against a 350 ms RPC attempt timeout, and it fails permanently on a full disk. Truncating in place preserves the inode and the shared `O_APPEND` open file description, so both the keeper and the pi child continue writing into the bounded file.

The bound is **steady-state, not instantaneous**: size is sampled on a cadence, so a burst writer MAY exceed the cap by up to one check interval of output before the next check truncates. Per-session steady-state disk usage SHALL be one cap, not a multiple.

The keeper SHALL check the log size on two triggers, because either writer alone can drive growth:
1. from its own `log()` writer, throttled to at most one size check per `keeperLog.checkIntervalMs` (default 5 s) so the hot path stays cheap; and
2. from a periodic timer on the same interval, `unref()`'d so it never keeps the keeper alive — required because with capture enabled the growth comes from the pi child, which the keeper's own writer never observes.

The size check SHALL use `fs.fstatSync(logFd)`, not a path stat, so it observes the object the writes go to even if the path is unlinked or replaced underneath.

Truncation SHALL NOT reset any writer's file offset, and correctness after truncation therefore depends on every writer holding `O_APPEND`. The keeper SHALL keep opening the log with mode `"a"` and SHALL NOT perform positioned writes to it; a positioned write after a truncation would recreate a sparse multi-gigabyte file.

Rotation SHALL be best-effort and SHALL NOT alter keeper lifecycle. Both trigger call sites SHALL contain their own `try/catch`: the keeper installs an `uncaughtException` handler that shuts the session down, so an unguarded throw from the timer callback would end the session over a logging concern. Any failure SHALL degrade to a single diagnostic line and a skipped rotation, and SHALL NOT crash the keeper, abort pi, or block the RPC forward path.

#### Scenario: Log truncates when it exceeds the cap
- **WHEN** `keeper-<sessionId>.log` reaches or exceeds `keeperLog.maxBytes` and a size check fires
- **THEN** the keeper SHALL truncate `keeper-<sessionId>.log` to zero length
- **AND** subsequent keeper log lines SHALL appear in the truncated file

#### Scenario: Inode is preserved so the pi child keeps writing into the bounded file
- **WHEN** rotation occurs while the pi child holds the log descriptor as its stdout/stderr
- **THEN** the inode of `keeper-<sessionId>.log` SHALL be unchanged across the rotation
- **AND** output written by the pi child after rotation SHALL appear in `keeper-<sessionId>.log`
- **AND** the size of `keeper-<sessionId>.log` after rotation SHALL be less than `keeperLog.maxBytes`

#### Scenario: No rotated generation is produced
- **WHEN** the log rotates any number of times
- **THEN** no `keeper-<sessionId>.log.1` or other generation file SHALL exist
- **AND** no copy of the log SHALL be made at rotation time

#### Scenario: Growth driven only by the pi child still triggers rotation
- **WHEN** `PI_KEEPER_CAPTURE_PI_OUTPUT` is `"1"` and the pi child writes past the cap while the keeper itself emits no log lines
- **THEN** the periodic size check SHALL detect the excess
- **AND** the log SHALL be truncated without any keeper-originated write

#### Scenario: Descriptor truncation refused falls back to path truncation
- **WHEN** `fs.ftruncateSync(logFd, 0)` throws (e.g. a Win32 `O_APPEND` handle without `FILE_WRITE_DATA`)
- **THEN** the keeper SHALL attempt `fs.truncateSync(logPath, 0)`
- **AND** the log SHALL end up below the cap when the fallback succeeds

#### Scenario: Fallback refuses a path that no longer names the measured file
- **WHEN** descriptor truncation throws and `logPath` resolves to a different inode than `logFd`
- **THEN** the keeper SHALL NOT truncate that path
- **AND** the rotation SHALL be skipped as a failure

#### Scenario: Rotation failure never crashes the keeper or ends the session
- **WHEN** both truncation attempts throw, on either trigger path including the interval timer
- **THEN** the keeper SHALL continue running and SHALL keep forwarding RPC lines to pi
- **AND** the keeper SHALL NOT invoke its shutdown path
- **AND** the keeper SHALL NOT retry more often than the normal check interval

### Requirement: Keeper log bounds SHALL be configured, not hardcoded twice

`config.keeperLog` SHALL carry `maxBytes` (default `134217728`) and `checkIntervalMs` (default `5000`). `parseKeeperLogConfig` SHALL parse and validate both keys — it currently returns only `capturePiOutput` and drops unknown keys, which would silently discard an operator's setting while `config.json` still displays it.

The server SHALL pass them to the keeper at spawn time as the env vars `PI_KEEPER_LOG_MAX_BYTES` and `PI_KEEPER_LOG_CHECK_INTERVAL_MS`, following the existing `PI_KEEPER_CAPTURE_PI_OUTPUT` plumbing, and SHALL use the same config values for the sweep and stats thresholds. `keeper.cjs` SHALL read them from the environment and fall back to the same defaults when unset or unparseable, and SHALL remain CJS-pure — no import of the shared config.

The keeper SHALL delete both variables from the environment it passes to the pi child, as it already does for `PI_KEEPER_CAPTURE_PI_OUTPUT` and as `keeper-env.cjs` does for `PI_KEEPER_PI_ARGS` / `PI_KEEPER_PI_CMD`. Keeper-internal tuning SHALL NOT leak into pi's observable environment.

#### Scenario: Config drives the keeper's cap
- **WHEN** `config.keeperLog.maxBytes` is set and a keeper is spawned
- **THEN** the keeper process env SHALL carry `PI_KEEPER_LOG_MAX_BYTES` with that value
- **AND** the keeper SHALL rotate at that threshold rather than the default

#### Scenario: Config values survive parsing
- **WHEN** `config.json` sets `keeperLog.maxBytes` and `keeperLog.checkIntervalMs` to valid positive numbers
- **THEN** `loadConfig().keeperLog` SHALL report those values, not the defaults
- **AND** an absent, non-numeric, or non-positive value SHALL fall back to the default for that key

#### Scenario: Absent or invalid env falls back to the defaults
- **WHEN** `PI_KEEPER_LOG_MAX_BYTES` or `PI_KEEPER_LOG_CHECK_INTERVAL_MS` is unset, empty, non-numeric, or non-positive
- **THEN** the keeper SHALL use 128 MiB / 5000 ms respectively
- **AND** the keeper SHALL start normally

#### Scenario: Keeper-internal log vars do not reach pi
- **WHEN** the keeper spawns its pi child with either log env var set in its own environment
- **THEN** the child environment SHALL NOT contain `PI_KEEPER_LOG_MAX_BYTES` or `PI_KEEPER_LOG_CHECK_INTERVAL_MS`
