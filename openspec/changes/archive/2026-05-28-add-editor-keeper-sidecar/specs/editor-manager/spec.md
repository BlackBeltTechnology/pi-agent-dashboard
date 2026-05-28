## MODIFIED Requirements

### Requirement: Spawn code-server per folder
The EditorManager SHALL ensure exactly one code-server instance per folder cwd. Spawning SHALL be delegated to the editor keeper sidecar (see `editor-keeper-sidecar`); the dashboard server does NOT spawn code-server directly. The `editorId` SHALL be `sha256(cwd).slice(0,12)` and stable across dashboard restarts. The instance SHALL bind to `127.0.0.1` on a dynamically allocated free port (allocated by the dashboard before spawning the keeper and passed to the keeper via argv). The instance SHALL use `--auth none`, `--disable-telemetry`, `--disable-update-check`, and `--user-data-dir ~/.pi/dashboard/editors/<editorId>/`.

`start(cwd)` SHALL follow a 3-way resolution:

1. **In-memory hit**: an instance for cwd already tracked → return it.
2. **Reattach**: an editor-keeper sidecar exists for cwd's `editorId`, its socket+TCP probes succeed → register in memory with the same `editorId` and return without spawning.
3. **Fresh spawn**: otherwise → spawn a keeper, wait for its socket to accept, register, return.

#### Scenario: Fresh spawn delegates to keeper
- **WHEN** `start(cwd)` is called and neither in-memory nor sidecar state exists for cwd
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

### Requirement: Persistent editor PID registry
The dashboard server SHALL discover editor instances on startup by scanning `~/.pi/dashboard/editors/*.pid` sidecars written by editor keepers (see `editor-keeper-sidecar`). The legacy `editor-pids.json` aggregate file is REMOVED. The legacy `cleanupOrphans()` cmdline-scan SHALL be retained as a defensive sweep that runs AFTER sidecar adoption, scoped to code-server processes whose `--user-data-dir` matches the dashboard marker but for which no sidecar exists (pre-keeper installs being upgraded).

#### Scenario: Adoption succeeds for a live keeper
- **WHEN** the dashboard server starts and finds a sidecar with both `keeperPid` and `childPid` alive and probes succeed
- **THEN** the editor SHALL be registered in `editor-manager` with the sidecar's `editorId` and `port`

#### Scenario: Defensive cmdline sweep for pre-keeper installs
- **WHEN** the dashboard server starts and finds a code-server process with `--user-data-dir` under `~/.pi/dashboard/editors/` but no matching sidecar exists
- **THEN** the dashboard SHALL SIGTERM that process via the legacy `cleanupOrphans()` path
- **AND** the dashboard SHALL log a one-line notice indicating the upgrade-cleanup
