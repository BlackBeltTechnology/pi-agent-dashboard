## MODIFIED Requirements

### Requirement: RPC keeper sidecar process per headless session
For every headless pi session spawned via `spawnPiSession({strategy: "headless"})`, the dashboard server SHALL spawn a per-session keeper process (`packages/server/src/rpc-keeper/keeper.cjs`) BEFORE spawning pi. The keeper SHALL spawn pi as its own child process, owning pi's stdin pipe.

The `PI_KEEPER_CAPTURE_PI_OUTPUT` env var SHALL gate ALL keeper log output. The server SHALL derive it solely from `config.keeperLog.capturePiOutput` at spawn time. It SHALL set the var to `"1"` when the config is `true`, and SHALL remove it from the keeper env when the config is `false` (matching the key case-insensitively, since Windows env names are case-insensitive), so a value inherited from the server's own environment can never enable logging.

- When capture is enabled (`"1"`), the keeper SHALL open `keeper-<sessionId>.log`, SHALL write its own lifecycle log lines (`keeper starting`, `spawning pi`, `pi exited code=…`, errors) to it via its internal `log()` writer, and SHALL spawn pi with `stdio: ["pipe", logFd, logFd]` so pi's stdout/stderr are appended to the same file.
- When capture is disabled (unset, empty, or any value other than `"1"`; the default), the keeper SHALL NOT create or open `keeper-<sessionId>.log`, its `log()` writer SHALL be a no-op, it SHALL NOT start any log-size check or rotation timer, and it SHALL spawn pi with `stdio: ["pipe", "ignore", "ignore"]` so pi's stdout/stderr are discarded.

The keeper SHALL strip `PI_KEEPER_CAPTURE_PI_OUTPUT` from the env it passes to pi. The keeper SHALL outlive dashboard server restarts: when the dashboard server exits, the keeper SHALL continue running and pi SHALL continue running. The keeper SHALL exit with code 0 when its child pi exits.

The keeper SHALL be a CommonJS file (`.cjs`) with no TypeScript loader, jiti, or tsx dependencies. It imports only Node built-in modules (`child_process`, `net`, `fs`, `path`). This mirrors the precedent set by `packages/server/preload-fastify.cjs`.

#### Scenario: Keeper spawned before pi
- **WHEN** `spawnPiSession(cwd, {strategy: "headless"})` is invoked
- **THEN** the dashboard server SHALL spawn `node <path>/keeper.cjs <sessionId>` with the spawn env
- **AND** the keeper process SHALL spawn `pi --mode rpc` as its child
- **AND** pi's stdin SHALL be a pipe owned by the keeper process

#### Scenario: Capture disabled by default discards pi output
- **WHEN** the keeper starts and `PI_KEEPER_CAPTURE_PI_OUTPUT` is unset, empty, or not `"1"`
- **THEN** the keeper SHALL spawn pi with `stdio: ["pipe", "ignore", "ignore"]`
- **AND** no `keeper-<sessionId>.log` file SHALL exist in the sessions directory for that session at any point during the keeper's lifetime, including after it shuts down
- **AND** the keeper SHALL still bind its socket, spawn pi, write its PID sidecars, and forward RPC lines normally

#### Scenario: Capture enabled archives pi output
- **WHEN** the keeper starts and `PI_KEEPER_CAPTURE_PI_OUTPUT` is `"1"`
- **THEN** the keeper SHALL spawn pi with `stdio: ["pipe", logFd, logFd]`
- **AND** `keeper-<sessionId>.log` SHALL contain the keeper's lifecycle lines
- **AND** pi's stdout/stderr SHALL be appended to `keeper-<sessionId>.log`

#### Scenario: Inherited env var cannot enable logging when the toggle is off
- **WHEN** the dashboard server process itself has `PI_KEEPER_CAPTURE_PI_OUTPUT=1` in its environment and `config.keeperLog.capturePiOutput` is `false`
- **THEN** the keeper env SHALL NOT contain `PI_KEEPER_CAPTURE_PI_OUTPUT`
- **AND** no keeper log file SHALL be created for that spawn

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

### Requirement: Keeper failure modes
The keeper SHALL handle these failure modes. "Log" below means the keeper's `log()` writer. It writes to `keeper-<sessionId>.log` only when capture is enabled and is a no-op otherwise. Exit codes and socket handling SHALL be identical whether or not capture is enabled.

- **pi child fails to spawn** (e.g. binary missing): keeper logs a single-line error and exits non-zero; UDS socket / named pipe SHALL NOT be created.
- **pi child crashes during operation**: keeper detects via `child.on("exit", ...)`, unlinks socket + PID file, exits 0.
- **UDS socket connection refused** (path collision with stale socket): keeper SHALL attempt to unlink the existing socket file before binding, retry once, then exit non-zero with a clear log message.
- **Write to pi.stdin after pi has exited**: keeper SHALL detect EPIPE / closed-stream errors, log them, and exit (the same path as "pi child crashes").
- **Out-of-order startup race** (server connects before keeper has bound socket): keeper SHALL bind socket BEFORE spawning pi; server SHALL retry connect with exponential backoff (max 3 attempts, ~500ms total) before emitting an `error` feedback.

When the server's crash-window check sees the keeper exit early (`PI_CRASHED`), the message SHALL include the keeper exit code and SHALL reflect the capture setting actually passed to that keeper:
- capture enabled → the message SHALL name both `keeper-<sessionId>.log` and `keeper-launch-<sessionId>.log` (startup errors raised before the keeper opens its own log land in the launch log);
- capture disabled → the message SHALL tell the user to enable "Capture pi session output (debug)" in Settings and start a new session, and SHALL NOT name any log file.

#### Scenario: pi binary missing on keeper startup
- **WHEN** the keeper attempts to spawn `pi --mode rpc` and the binary is not found
- **THEN** the keeper SHALL log the error (to `keeper-<sessionId>.log` when capture is enabled)
- **AND** the keeper SHALL exit non-zero
- **AND** the keeper SHALL NOT create the UDS socket / named pipe

#### Scenario: pi binary missing with capture disabled leaves no file
- **WHEN** capture is disabled and the keeper fails to spawn pi
- **THEN** the keeper SHALL exit non-zero
- **AND** no `keeper-<sessionId>.log` and no `keeper-launch-<sessionId>.log` SHALL be created

#### Scenario: Stale socket file from previous keeper crash
- **WHEN** the keeper attempts to bind its UDS socket and the path already exists
- **THEN** the keeper SHALL `unlink()` the path
- **AND** the keeper SHALL retry the bind exactly once
- **AND** if the second bind fails, the keeper SHALL exit non-zero

#### Scenario: Crash-window error with capture disabled points at the toggle
- **WHEN** capture is disabled and the keeper exits within the server's crash window
- **THEN** the spawn result SHALL have code `PI_CRASHED`
- **AND** its message SHALL tell the user to enable "Capture pi session output (debug)" and start a new session
- **AND** its message SHALL NOT reference any `keeper-*.log` file

#### Scenario: Crash-window error with capture enabled points at both logs
- **WHEN** capture is enabled and the keeper exits within the server's crash window
- **THEN** the spawn result message SHALL reference `keeper-<sessionId>.log` and `keeper-launch-<sessionId>.log`

### Requirement: Keeper log SHALL be size-bounded by in-place truncation

This requirement applies only when capture is enabled (`PI_KEEPER_CAPTURE_PI_OUTPUT` is `"1"`). When capture is disabled there is no keeper log, so the keeper SHALL perform no size check and SHALL NOT start the periodic rotation timer. Its absence SHALL NOT raise any error.

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

#### Scenario: No rotation machinery when capture is disabled
- **WHEN** the keeper starts with `PI_KEEPER_CAPTURE_PI_OUTPUT` unset
- **THEN** the keeper SHALL NOT start a rotation timer or perform any log size check
- **AND** the keeper SHALL reach ready state and serve RPC lines without error

## ADDED Requirements

### Requirement: Launch-stderr log is created only when capture is enabled
The dashboard server SHALL create `keeper-launch-<sessionId>.log` (which receives the keeper process's own stdout/stderr) only when capture is enabled for that spawn. When capture is disabled, the server SHALL spawn the keeper with its stdout/stderr discarded and SHALL NOT create the launch log.

#### Scenario: Capture disabled spawns no launch log
- **WHEN** a headless session is spawned with `keeperLog.capturePiOutput` false or absent
- **THEN** no `keeper-launch-<sessionId>.log` SHALL be created in the sessions directory

#### Scenario: Capture enabled spawns a launch log
- **WHEN** a headless session is spawned with `keeperLog.capturePiOutput` true
- **THEN** `keeper-launch-<sessionId>.log` SHALL be created and receive the keeper's own stdout/stderr

### Requirement: Server closes its launch-log descriptor after spawning the keeper
When the server opens `keeper-launch-<sessionId>.log`, it SHALL close its own descriptor once the keeper spawn attempt returns, whether it succeeded or failed. The keeper's inherited copy stays open.

#### Scenario: Server does not leak the launch-log descriptor
- **WHEN** a headless session is spawned with capture enabled
- **THEN** after the spawn call returns, the server process SHALL NOT hold an open descriptor on `keeper-launch-<sessionId>.log`
