## ADDED Requirements

### Requirement: Editor keeper sidecar process per editor instance
For every `code-server` instance the dashboard spawns, the dashboard server SHALL spawn a per-editor keeper process (`packages/server/src/editor-keeper/keeper.cjs`) detached, with its own session/process group, BEFORE spawning code-server. The keeper SHALL spawn code-server as its own child with `stdio: ["ignore", logFd, logFd]` and own the child's lifecycle. The keeper SHALL outlive dashboard server restarts: when the dashboard server exits (graceful or crash), the keeper SHALL continue running and code-server SHALL continue running. The keeper SHALL exit with code 0 when its child exits.

The keeper SHALL be a CommonJS file (`.cjs`) with no TypeScript loader, jiti, or tsx dependencies — it imports only Node built-in modules (`child_process`, `net`, `fs`, `path`, `os`). This mirrors `packages/server/preload-fastify.cjs` and `packages/server/src/rpc-keeper/keeper.cjs`.

#### Scenario: Keeper spawned before code-server
- **WHEN** `editorManager.start(cwd)` is invoked and no in-memory or sidecar instance exists for the cwd
- **THEN** the dashboard server SHALL spawn `node <path>/keeper.cjs <editorId> <cwd> <port> <binary> <dataDir>` with `detached: true` and a fresh session/PGID
- **AND** the keeper SHALL spawn code-server as its child
- **AND** the keeper SHALL write its PID sidecar (see "PID sidecar file") before exiting startup
- **AND** the keeper SHALL bind its socket / named pipe before signalling readiness

#### Scenario: Keeper survives dashboard server restart
- **WHEN** the dashboard server exits (graceful `/api/shutdown`, `pi-dashboard stop`, SIGTERM, or crash) while an editor instance is active
- **THEN** the keeper process SHALL continue running
- **AND** code-server SHALL continue running, still bound to its port
- **AND** when the new dashboard server starts, it SHALL adopt the editor via the boot-time adoption path

#### Scenario: Keeper exits when child exits
- **WHEN** the code-server child exits (any reason)
- **THEN** the keeper SHALL detect the exit via `child.on("exit", ...)`
- **AND** the keeper SHALL broadcast `{"event":"child_exit","code":N,"signal":S}` to every currently-connected socket client
- **AND** the keeper SHALL unlink its socket file (POSIX) and PID sidecar
- **AND** the keeper SHALL exit with code 0


### Requirement: Stable editor id derived from cwd
The `editorId` SHALL be derived deterministically from the cwd as `sha256(cwd).slice(0,12)` (12 hex chars). The same cwd SHALL always produce the same `editorId` across restarts. This replaces the previous random-id scheme so that the `/editor/<id>/` proxy URL is stable across dashboard restarts and the browser iframe does not need to reload.

#### Scenario: Same cwd yields same id across restarts
- **WHEN** `start("/Users/x/proj")` is called, the dashboard restarts, and `start("/Users/x/proj")` is called again
- **THEN** both calls SHALL return the same `editorId`
- **AND** the `/editor/<editorId>/` proxy URL SHALL forward to the same code-server port (assuming the keeper survived)


### Requirement: Per-editor UDS socket / Windows named pipe
On Unix (macOS, Linux), the keeper SHALL listen on `~/.pi/dashboard/editors/<editorId>.sock` (Unix domain socket). On Windows, the keeper SHALL listen on `\\.\pipe\pi-editor-<editorId>` (named pipe). The path SHALL be derived deterministically from the `editorId` so the dashboard server can locate it without consulting any registry.

#### Scenario: POSIX socket path derivation
- **WHEN** keeper for `editorId="abc123def456"` starts on macOS or Linux
- **THEN** the keeper SHALL listen on `<homedir>/.pi/dashboard/editors/abc123def456.sock`

#### Scenario: Windows named-pipe path derivation
- **WHEN** keeper for `editorId="abc123def456"` starts on Windows
- **THEN** the keeper SHALL listen on `\\.\pipe\pi-editor-abc123def456`


### Requirement: PID sidecar file
The keeper SHALL write a JSON sidecar file containing `{editorId, keeperPid, childPid, port, cwd, dataDir, binary, spawnedAt}` to `<sockPath>.pid` (POSIX) or `<homedir>/.pi/dashboard/editors/pi-editor-<editorId>.pid` (Windows). The sidecar SHALL be written before the keeper accepts socket connections. The sidecar SHALL be unlinked when the child exits.

#### Scenario: Sidecar contents
- **WHEN** the keeper for editor `abc123def456` has spawned code-server PID 4242 on port 38291
- **THEN** the sidecar file SHALL contain a JSON object with at least `keeperPid` (number), `childPid: 4242`, `port: 38291`, `editorId: "abc123def456"`, `cwd`, `dataDir`, and an ISO 8601 `spawnedAt` timestamp

#### Scenario: Sidecar cleanup on child exit
- **WHEN** the code-server child exits
- **THEN** the keeper SHALL unlink the PID sidecar
- **AND** on POSIX the keeper SHALL also unlink the socket file


### Requirement: JSON-line command protocol
The keeper's UDS / named-pipe protocol SHALL be JSON-lines. Commands accepted on incoming connections:

- `{"cmd":"heartbeat"}` — keeper acknowledges with `{"event":"ack"}`.
- `{"cmd":"stop"}` — keeper SHALL send SIGTERM to its child, wait up to 5 s, then SIGKILL the child's process group, then exit 0.
- `{"cmd":"getStatus"}` — keeper SHALL reply with `{"event":"status","childPid":P,"port":N,"uptimeMs":M}`.

Events emitted by the keeper:

- `{"event":"child_exit","code":N,"signal":S}` SHALL be broadcast to all currently-connected clients when the child exits.

Unknown `cmd` values SHALL be ignored and logged. The keeper SHALL accept multiple concurrent connections.

#### Scenario: getStatus reply
- **WHEN** a client connects to the keeper's socket and writes `{"cmd":"getStatus"}\n`
- **THEN** the keeper SHALL reply on the same connection with a `{"event":"status",...}` JSON line within 100 ms

#### Scenario: stop command escalation
- **WHEN** a client writes `{"cmd":"stop"}\n` and the child does not exit within 5 s of SIGTERM
- **THEN** the keeper SHALL SIGKILL the child's process group
- **AND** the keeper SHALL exit 0 after the child reaps


### Requirement: Boot-time adoption replaces kill-orphans
On dashboard server startup, before any other editor work, the dashboard SHALL scan `~/.pi/dashboard/editors/*.pid` sidecars. For each sidecar:

1. Read `{editorId, keeperPid, childPid, port, cwd, dataDir}`.
2. If `keeperPid` alive AND `childPid` alive AND socket probe returns `{"event":"status",...}` within 500 ms AND TCP probe of `127.0.0.1:port` connects: **adopt**. Register the editor in `editor-manager`'s in-memory state with `id=editorId`, start a fresh idle timer.
3. If `keeperPid` alive AND `childPid` dead: send `{"cmd":"stop"}` over socket, wait 1 s, SIGTERM `keeperPid`, unlink sidecar + socket.
4. If `keeperPid` dead AND `childPid` alive: SIGTERM the child's process group via `childPid`, unlink sidecar.
5. If both dead: unlink sidecar (and socket file on POSIX).

The legacy `editor-pid-registry.cleanupOrphans()` cmdline-scan SHALL run AFTER adoption, scoped to code-server processes that have no matching sidecar (defensive cleanup of pre-keeper installs).

#### Scenario: Both keeper and child alive across server restart
- **WHEN** the dashboard server starts and finds a sidecar with `keeperPid=K` (alive), `childPid=C` (alive), and socket+TCP probes succeed
- **THEN** the server SHALL register the editor with id `editorId` in `editor-manager`'s in-memory state
- **AND** the server SHALL NOT spawn a new keeper for that cwd

#### Scenario: Orphan keeper (child died)
- **WHEN** the dashboard server finds a sidecar with `keeperPid=K` alive but `childPid=C` dead
- **THEN** the server SHALL write `{"cmd":"stop"}` to the keeper's socket
- **THEN** if the keeper has not exited within 1 s, the server SHALL send SIGTERM to `keeperPid`
- **AND** the server SHALL unlink the sidecar + socket file
- **AND** the server SHALL NOT register the editor

#### Scenario: Both dead (stale sidecar)
- **WHEN** the dashboard server finds a sidecar with `keeperPid=K` and `childPid=C` both dead
- **THEN** the server SHALL unlink the sidecar
- **AND** the server SHALL unlink the socket file on POSIX


### Requirement: Adoption-aware stop gated by config
Graceful dashboard shutdown behaviour SHALL be controlled by `EditorConfig.stopOnDashboardExit` (default `false`). When the flag is `false`, the dashboard SHALL NOT signal editor keepers on graceful shutdown (`pi-dashboard stop`, `/api/shutdown`, `/api/restart`) — keepers and their code-server children persist, and the next boot adopts them. When the flag is `true`, the dashboard SHALL send `{"cmd":"stop"}` to every keeper and wait for them to exit (up to 6 s each, in parallel) before the dashboard process exits.

Explicit user-initiated stop (`POST /api/editor/:id/stop` or `editorManager.stop(id)`) SHALL always send `{"cmd":"stop"}` to the keeper regardless of the flag.

#### Scenario: Default — graceful exit preserves editors
- **WHEN** `editor.stopOnDashboardExit` is `false` (default) and the dashboard exits via `pi-dashboard stop` or `/api/shutdown` while editor instances are active
- **THEN** no keeper SHALL be signalled
- **AND** all code-server children SHALL remain running
- **AND** the next dashboard boot SHALL adopt them

#### Scenario: Opt-in — graceful exit stops editors
- **WHEN** `editor.stopOnDashboardExit` is `true` and the dashboard exits gracefully while editor instances are active
- **THEN** the dashboard SHALL write `{"cmd":"stop"}` to every keeper socket in parallel
- **THEN** the dashboard SHALL wait up to 6 s for every keeper to exit before its own process exits
- **AND** all PID sidecars + socket files SHALL be cleaned up

#### Scenario: Explicit stop endpoint always kills the keeper
- **WHEN** `POST /api/editor/:id/stop` is called
- **THEN** the server SHALL send `{"cmd":"stop"}` to the keeper for that id, regardless of the flag value
- **AND** the keeper SHALL terminate its child within 5 s and exit
- **AND** the sidecar + socket SHALL be cleaned up


### Requirement: Keeper failure modes
The keeper SHALL handle:

- **code-server binary missing**: keeper logs the error, does not bind socket, exits non-zero. No sidecar is written.
- **Port already in use**: keeper exits non-zero with a logged error.
- **Stale socket file from previous keeper crash** (POSIX): keeper SHALL `unlink()` the path, retry bind once, then exit non-zero if it still fails.
- **Child crashes during operation**: keeper detects via `exit`, broadcasts `child_exit`, cleans up, exits 0.
- **Keeper itself crashes**: child is orphaned. Next dashboard boot's adoption path detects "child alive + keeper dead" and SIGTERMs the child.

#### Scenario: Stale socket on POSIX
- **WHEN** the keeper starts and `<editorId>.sock` already exists from a previous crash
- **THEN** the keeper SHALL `unlink()` the path and retry bind exactly once
- **AND** if the second bind fails, the keeper SHALL exit non-zero with a log message

#### Scenario: code-server binary missing
- **WHEN** the keeper attempts to spawn code-server and the binary is not found
- **THEN** the keeper SHALL log the error
- **AND** the keeper SHALL NOT create the socket / named pipe
- **AND** the keeper SHALL NOT write the PID sidecar
- **AND** the keeper SHALL exit non-zero
