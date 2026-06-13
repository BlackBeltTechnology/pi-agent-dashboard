## ADDED Requirements

### Requirement: Spawn code-server per folder
The EditorManager SHALL ensure exactly one code-server instance per folder cwd. Spawning SHALL be delegated to the editor keeper sidecar (see `editor-keeper-sidecar`); the dashboard server does NOT spawn code-server directly. The `editorId` SHALL be `sha256(cwd).slice(0,12)` and stable across dashboard restarts. The instance SHALL bind to `127.0.0.1` on a dynamically allocated free port (allocated by the dashboard before spawning the keeper and passed to the keeper via argv). The instance SHALL use `--auth none`, `--disable-telemetry`, `--disable-update-check`, and `--user-data-dir ~/.pi/dashboard/editors/<editorId>/`.

On the fresh-spawn path, before spawning the keeper, the EditorManager SHALL seed `~/.pi/dashboard/editors/<editorId>/User/settings.json` with persistence-friendly defaults merged with any existing values; user-set values SHALL take precedence over seeded defaults. Seeded keys SHALL include the theme keys plus `window.restoreWindows: "all"`, `workbench.editor.restoreViewState: true`, `files.hotExit: "onExitAndWindowClose"`, `security.workspace.trust.enabled: false`, `update.mode: "none"`, `extensions.autoCheckUpdates: false`, and `workbench.startupEditor: "none"`.

Concurrent `start(cwd)` calls for the same cwd SHALL be deduplicated to a single in-flight resolution: at most one keeper SHALL be spawned for a cwd, and all concurrent callers SHALL resolve to the same instance. This prevents two code-servers racing on one `--user-data-dir`.

`start(cwd)` SHALL follow a 3-way resolution:

1. **In-memory hit**: an instance for cwd already tracked → return it.
2. **Reattach**: an editor-keeper sidecar exists for cwd's `editorId`, its socket+TCP probes succeed → register in memory with the same `editorId` and return without spawning.
3. **Fresh spawn**: otherwise → spawn a keeper, wait for its socket to accept, register, return.

#### Scenario: Fresh spawn delegates to keeper
- **WHEN** `start(cwd)` is called and neither in-memory nor sidecar state exists for cwd
- **THEN** `<dataDir>/User/settings.json` SHALL be written with the seeded persistence keys merged over any existing content
- **THEN** a free port SHALL be allocated
- **THEN** the dashboard SHALL spawn the editor keeper detached with argv `<editorId> <cwd> <port> <binary> <dataDir>`
- **THEN** the dashboard SHALL wait until either the keeper's socket probe returns a `status` event or `waitForPort(port)` succeeds (whichever first), within 15 s
- **THEN** `editor-manager` SHALL return `{ id: editorId, port, status: "ready" }`

#### Scenario: Reattach to surviving keeper after dashboard restart
- **WHEN** the dashboard restarts and a previously-running editor for cwd has a live keeper + child
- **AND** the user (or a client) calls `start(cwd)` (or boot-time adoption runs)
- **THEN** the dashboard SHALL connect to the keeper's socket, verify `getStatus`, populate in-memory state with id `editorId` and the keeper-owned port
- **THEN** `editor-manager` SHALL return `{ id: editorId, port, status: "ready" }`
- **AND** no new code-server process SHALL be spawned

#### Scenario: Instance already exists in memory
- **WHEN** `start(cwd)` is called and an in-memory instance is already tracked for cwd
- **THEN** the existing instance's `{ id, port }` SHALL be returned without contacting the keeper

#### Scenario: User customization preserved across spawns
- **WHEN** `<dataDir>/User/settings.json` already contains `"security.workspace.trust.enabled": true` from a prior user edit
- **AND** `start(cwd)` is called again for that cwd on the fresh-spawn path
- **THEN** the resulting `settings.json` SHALL retain `"security.workspace.trust.enabled": true`
- **THEN** other seeded keys absent from the existing file SHALL be added

#### Scenario: Concurrent start for the same folder
- **WHEN** two or more `start(cwd)` calls for the same cwd are in flight before the first has registered its instance (e.g. multiple browser tabs/iframes opening the same folder, or post-restart heartbeat re-starts)
- **THEN** at most one code-server keeper SHALL be spawned for that cwd
- **THEN** all concurrent callers SHALL resolve to the same `{ id, port }` instance
- **THEN** no duplicate code-server SHALL be started against the same `--user-data-dir`

### Requirement: Stop instance
The EditorManager SHALL stop a running instance by sending `{"cmd":"stop"}` to its keeper over the per-editor socket / named pipe. The keeper handles SIGTERM → 5 s grace → SIGKILL escalation against the code-server child. The dashboard SHALL remove the in-memory entry when it receives the keeper's `{"event":"child_exit",...}` message, OR after a 6 s fallback timer if the keeper is unreachable. On dashboard graceful shutdown, `stopAll()` behaviour SHALL be controlled by `EditorConfig.stopOnDashboardExit` (default `false` — no-op against keepers, editors persist).

#### Scenario: Stop via keeper command
- **WHEN** `stop(id)` is called for a running instance
- **THEN** the dashboard SHALL write `{"cmd":"stop"}\n` to the keeper's socket
- **THEN** on receiving `{"event":"child_exit",...}` (or after 6 s) the instance SHALL be removed from tracking

#### Scenario: Dashboard shutdown with default config preserves editors
- **WHEN** `editor.stopOnDashboardExit` is `false` (default) and the dashboard exits gracefully with editor instances active
- **THEN** `stopAll()` SHALL NOT signal any keeper
- **AND** all code-server children SHALL remain running
- **AND** the next dashboard boot SHALL adopt them

#### Scenario: Dashboard shutdown with opt-in stops editors
- **WHEN** `editor.stopOnDashboardExit` is `true` and the dashboard exits gracefully
- **THEN** `stopAll()` SHALL send `{"cmd":"stop"}` to every keeper in parallel and wait up to 6 s per keeper before returning

#### Scenario: Stop non-existent instance
- **WHEN** `stop(id)` is called for an unknown id
- **THEN** no error SHALL be thrown

### Requirement: Idle timeout
The EditorManager SHALL track the last heartbeat timestamp per instance. When no heartbeat has been received for `editor.idleTimeoutMinutes` (default 10), the instance SHALL be stopped automatically.

#### Scenario: Instance goes idle
- **WHEN** no heartbeat is received for 10 minutes (default)
- **THEN** the instance SHALL be stopped via SIGTERM
- **THEN** an `editor_status` message with status `stopped` SHALL be broadcast

#### Scenario: Heartbeat resets idle timer
- **WHEN** a heartbeat is received for an instance
- **THEN** the idle timer SHALL be reset to the full timeout duration

### Requirement: Max concurrent instances
The EditorManager SHALL enforce a maximum number of concurrent running instances (default 3, configurable via `editor.maxInstances`). When the cap is reached and a new start is requested, the oldest idle instance SHALL be stopped first. If no idle instance exists, the start SHALL fail with an error.

#### Scenario: Cap reached with idle instance
- **WHEN** the max instance cap is reached and a new start is requested
- **THEN** the instance with the oldest last-heartbeat timestamp SHALL be stopped
- **THEN** the new instance SHALL be started

#### Scenario: Cap reached with no idle instances
- **WHEN** the max instance cap is reached and all instances have recent heartbeats
- **THEN** the start request SHALL fail with `{ error: "max_instances_reached" }`

### Requirement: Reverse proxy route
The dashboard server SHALL register a reverse proxy route at `/editor/:id/*` that forwards all HTTP and WebSocket traffic to `http://127.0.0.1:<port>` of the corresponding code-server instance. The proxy SHALL handle WebSocket upgrade for code-server's LSP and terminal connections.

#### Scenario: HTTP request proxied
- **WHEN** a browser request arrives at `/editor/abc123/some/path`
- **THEN** the server SHALL forward it to `http://127.0.0.1:<port>/some/path`
- **THEN** the response SHALL be returned to the browser

#### Scenario: WebSocket upgrade proxied
- **WHEN** a WebSocket upgrade request arrives at `/editor/abc123/`
- **THEN** the server SHALL upgrade and proxy to `ws://127.0.0.1:<port>/`

#### Scenario: Unknown editor id
- **WHEN** a request arrives for an editor id with no running instance
- **THEN** the server SHALL respond with 404

### Requirement: Editor status broadcast
The EditorManager SHALL broadcast `editor_status` messages via the browser WebSocket when an instance's status changes (starting, ready, stopped).

#### Scenario: Instance started
- **WHEN** a code-server instance transitions to ready
- **THEN** an `editor_status` message SHALL be broadcast with `{ cwd, id, status: "ready" }`

#### Scenario: Instance stopped
- **WHEN** a code-server instance is stopped (idle timeout, manual stop, or crash)
- **THEN** an `editor_status` message SHALL be broadcast with `{ cwd, id, status: "stopped" }`

### Requirement: REST API endpoints
The server SHALL expose:
- `POST /api/editor/start` with body `{ cwd, theme? }` — starts or returns existing instance, writes VS Code settings.json with theme
- `POST /api/editor/:id/heartbeat` — resets idle timer
- `POST /api/editor/:id/stop` — stops instance
- `POST /api/editor/:id/theme` with body `{ theme }` — updates VS Code settings.json with new theme for a running instance
- `GET /api/editor/status` — returns all editor instances with their status
- `GET /api/editor/detect` — returns whether code-server binary is available

All endpoints SHALL be localhost-only.

#### Scenario: Start endpoint
- **WHEN** `POST /api/editor/start` is called with `{ cwd: "/path/to/project", theme: "dark" }`
- **THEN** the server SHALL write VS Code settings.json with dark theme
- **THEN** the server SHALL return `{ success: true, data: { id, status, proxyPath } }`

#### Scenario: Theme endpoint
- **WHEN** `POST /api/editor/:id/theme` is called with `{ theme: "light" }`
- **THEN** the server SHALL update VS Code settings.json with the light color theme
- **THEN** the server SHALL return `{ success: true }`

#### Scenario: Detect endpoint when binary exists
- **WHEN** `GET /api/editor/detect` is called and code-server is on PATH
- **THEN** the server SHALL return `{ success: true, data: { available: true, binary: "code-server" } }`

#### Scenario: Detect endpoint when binary missing
- **WHEN** `GET /api/editor/detect` is called and code-server is not found
- **THEN** the server SHALL return `{ success: true, data: { available: false } }`

### Requirement: Persistent editor PID registry
The dashboard server SHALL discover editor instances on startup by scanning `~/.pi/dashboard/editors/*.pid` sidecars written by editor keepers (see `editor-keeper-sidecar`). The legacy `editor-pids.json` aggregate file is REMOVED. The legacy `cleanupOrphans()` cmdline-scan SHALL be retained as a defensive sweep that runs AFTER sidecar adoption, scoped to code-server processes whose `--user-data-dir` matches the dashboard marker but for which no sidecar exists (pre-keeper installs being upgraded).

#### Scenario: Adoption succeeds for a live keeper
- **WHEN** the dashboard server starts and finds a sidecar with both `keeperPid` and `childPid` alive and probes succeed
- **THEN** the editor SHALL be registered in `editor-manager` with the sidecar's `editorId` and `port`

#### Scenario: Defensive cmdline sweep for pre-keeper installs
- **WHEN** the dashboard server starts and finds a code-server process with `--user-data-dir` under `~/.pi/dashboard/editors/` but no matching sidecar exists
- **THEN** the dashboard SHALL SIGTERM that process via the legacy `cleanupOrphans()` path
- **AND** the dashboard SHALL log a one-line notice indicating the upgrade-cleanup

### Requirement: Orphan code-server cleanup on server boot
On server startup, before accepting any new editor `start` requests, the dashboard server SHALL read `~/.pi/dashboard/editor-pids.json` and, for each persisted entry, attempt to terminate the corresponding `code-server` process if it is verified as a dashboard-spawned orphan. After processing, the registry file SHALL be cleared.

#### Scenario: Live verified orphan is terminated
- **WHEN** server boot reads a persisted entry whose PID is alive AND whose OS-reported command line contains `--user-data-dir` with a path under `~/.pi/dashboard/editors/`
- **THEN** the server SHALL send `SIGTERM` to that PID
- **THEN** if the process is still alive after a 1 second grace period, the server SHALL send `SIGKILL`

#### Scenario: Dead PID is skipped
- **WHEN** server boot reads a persisted entry whose PID is no longer alive
- **THEN** no signal SHALL be sent
- **THEN** the entry SHALL be discarded

#### Scenario: PID reuse — command line does not match
- **WHEN** server boot reads a persisted entry whose PID is alive but whose command line does NOT contain `--user-data-dir` under `~/.pi/dashboard/editors/`
- **THEN** no signal SHALL be sent (the PID has been reused by an unrelated process)
- **THEN** the entry SHALL be discarded

#### Scenario: Command-line lookup fails
- **WHEN** server boot cannot determine the command line for a persisted PID (platform error, permission denied, etc.)
- **THEN** no signal SHALL be sent (cannot verify ownership)
- **THEN** the entry SHALL be discarded

#### Scenario: Missing or corrupt registry file
- **WHEN** `~/.pi/dashboard/editor-pids.json` does not exist or cannot be parsed at server boot
- **THEN** the server SHALL proceed normally with an empty registry
- **THEN** no error SHALL be thrown and startup SHALL not be blocked

#### Scenario: Registry cleared after sweep
- **WHEN** the orphan sweep completes (regardless of how many orphans were killed)
- **THEN** `~/.pi/dashboard/editor-pids.json` SHALL be rewritten to reflect only entries the new server's `EditorManager` has registered (initially empty)

### Requirement: Boot sweep runs before new editor starts are accepted
The orphan cleanup sweep SHALL execute during server initialization, before the editor REST routes (`POST /api/editor/start`) accept any requests. This SHALL prevent races between cleanup and a new spawn for the same `cwd` (and therefore the same `--user-data-dir`).

#### Scenario: Cleanup precedes route registration
- **WHEN** the server starts
- **THEN** `editorPidRegistry.cleanupOrphans()` SHALL complete
- **THEN** the editor REST routes SHALL be registered
- **THEN** any `POST /api/editor/start` request SHALL be served against a clean state
