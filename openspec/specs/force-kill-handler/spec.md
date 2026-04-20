## Requirements

### Requirement: Force kill message type
The browser-to-server protocol SHALL support a `force_kill` message type with a `sessionId` field.

#### Scenario: force_kill message structure
- **WHEN** the browser sends a `force_kill` message
- **THEN** it SHALL contain `type: "force_kill"` and `sessionId: string`

### Requirement: Force kill result message type
The server-to-browser protocol SHALL support a `force_kill_result` message type with `sessionId`, `success`, and optional `message` fields.

#### Scenario: force_kill_result on success
- **WHEN** the server handles a `force_kill` (process killed, already dead, or WS-only close)
- **THEN** it SHALL send a `force_kill_result` with `success: true` and an optional descriptive `message`

#### Scenario: force_kill_result on unknown session
- **WHEN** the server receives a `force_kill` for a session that does not exist
- **THEN** it SHALL send a `force_kill_result` with `success: false` and a descriptive `message`

### Requirement: Server stores session PID
The server SHALL store the `pid` from `session_register` messages on the `DashboardSession` object.

#### Scenario: PID stored on registration
- **WHEN** the server receives a `session_register` with a `pid` field
- **THEN** the corresponding `DashboardSession` SHALL have `pid` set to that value

### Requirement: Force kill process escalation
When the server receives a `force_kill` message, it SHALL terminate the session's process using the platform-provided `killProcess(pid, { timeoutMs: 2000 })` helper so that the entire process subtree is terminated on every supported OS. On Windows this delegates to `taskkill /F /T /PID <pid>` (immediate tree kill). On POSIX this sends `SIGTERM`, waits up to 2 seconds, and sends `SIGKILL` if the process is still alive. The server SHALL NOT call `process.kill(pid, …)` directly.

#### Scenario: Windows tree kill via taskkill
- **WHEN** the server handles a `force_kill` on `process.platform === "win32"` for a session with a known PID
- **THEN** it SHALL invoke `killProcess(pid, { timeoutMs: 2000 })` from `@blackbelt-technology/pi-dashboard-shared/platform/process.js`
- **AND** the platform helper SHALL execute `taskkill /F /T /PID <pid>` so that descendant processes (tmux panes, `wt` tabs, pi child binaries) are also terminated

#### Scenario: POSIX SIGTERM sent first
- **WHEN** the server handles a `force_kill` on `process.platform === "linux"` or `"darwin"` for a session with a known PID
- **THEN** `killProcess` SHALL send `SIGTERM` to the PID first

#### Scenario: POSIX SIGKILL after timeout
- **WHEN** `killProcess` has sent `SIGTERM` AND the process is still alive after 2 seconds
- **THEN** `killProcess` SHALL send `SIGKILL` to the PID
- **AND** return `{ ok: true, forced: true }`

#### Scenario: Process already dead after SIGTERM
- **WHEN** `killProcess` has sent `SIGTERM` AND the process exits within 2 seconds
- **THEN** `killProcess` SHALL NOT send `SIGKILL`
- **AND** return `{ ok: true, forced: false }`

#### Scenario: No PID available
- **WHEN** a `force_kill` is received for a session with no stored PID
- **THEN** the server SHALL force-close the bridge WebSocket connection
- **AND** return `force_kill_result` with `success: true` and a message indicating WS-only kill

#### Scenario: No direct process.kill in the handler
- **WHEN** the repo-level enforcement test scans `packages/server/src/browser-handlers/session-action-handler.ts`
- **THEN** no `process.kill(` call SHALL be present
- **AND** all termination SHALL go through `killProcess` or `killPidWithGroup`

### Requirement: Session marked ended after force kill
After force-killing a process, the server SHALL mark the session as "ended" and broadcast a `session_updated` message. The session SHALL NOT be removed from the session list.

#### Scenario: Session status updated to ended
- **WHEN** a force kill completes (process killed or WS closed)
- **THEN** the session status SHALL be set to "ended"
- **AND** a `session_updated` broadcast SHALL be sent to all browser clients

#### Scenario: Session remains in sidebar
- **WHEN** a force kill completes
- **THEN** the session SHALL still appear in the session list (not removed)
- **AND** the session SHALL be resumable via fork or continue

### Requirement: Bridge WebSocket force-closed after kill
After sending SIGTERM, the server SHALL force-close the bridge WebSocket connection for that session.

#### Scenario: WebSocket closed on force kill
- **WHEN** the server handles a `force_kill`
- **THEN** it SHALL close the bridge WebSocket for that session via the pi-gateway

### Requirement: PID safety check before SIGKILL
Before sending SIGKILL, the server SHALL verify the PID still belongs to a pi-related process.

#### Scenario: PID verified on macOS/Linux
- **WHEN** the server is about to send SIGKILL
- **THEN** it SHALL check the process command line contains "pi" or "node"
- **AND** skip SIGKILL if the command line doesn't match

#### Scenario: PID check failure is non-fatal
- **WHEN** the PID verification command fails (process already exited)
- **THEN** the server SHALL treat the process as already dead and report success
