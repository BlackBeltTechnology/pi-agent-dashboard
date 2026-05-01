# server-restart

## ADDED Requirements

### Requirement: Restart broadcast precedes process exit

When the dashboard server is about to exit as part of a restart or shutdown initiated through `POST /api/restart` or `POST /api/shutdown`, the server SHALL broadcast a `server_restarting` message to every connected pi bridge before calling `process.exit(...)`. The message SHALL carry a `reason` (`"restart" | "shutdown"`) and a `quiesceMs` integer (default 5000) indicating how long bridges SHOULD pause auto-start.

#### Scenario: /api/restart broadcasts before exit

- **GIVEN** a dashboard server with three connected bridges
- **WHEN** a client calls `POST /api/restart`
- **THEN** every bridge SHALL receive a `server_restarting` message with `reason: "restart"` and `quiesceMs >= 1000`
- **AND** the message SHALL be delivered before the server's `process.exit(0)`

#### Scenario: /api/shutdown broadcasts before exit

- **GIVEN** a dashboard server with at least one connected bridge
- **WHEN** a client calls `POST /api/shutdown`
- **THEN** the connected bridge SHALL receive a `server_restarting` message with `reason: "shutdown"`

### Requirement: Bridges pause auto-start during quiesce window

A pi bridge that receives `server_restarting` SHALL suppress the auto-start spawn step in `server-auto-start.ts` for at least `quiesceMs` milliseconds from receipt, while continuing to perform mDNS discovery and health checks. Reconnection to the new server SHALL use the existing exponential-backoff path.

#### Scenario: bridge does not race the orchestrator

- **GIVEN** a bridge that has just received `server_restarting { quiesceMs: 5000 }`
- **WHEN** its WebSocket closes within the next 5 seconds
- **THEN** the bridge SHALL NOT call `launchServer(...)`
- **AND** the bridge SHALL continue to attempt reconnection via discovery + health check

#### Scenario: auto-start resumes after quiesce expires

- **GIVEN** a bridge whose quiesce window started 6 seconds ago with `quiesceMs: 5000`
- **AND** the dashboard is still not reachable via discovery or health check
- **WHEN** `autoStartServer(...)` is invoked
- **THEN** the auto-start spawn step SHALL execute as today

### Requirement: CLI restart delegates to /api/restart when dashboard is running

`pi-dashboard restart` SHALL probe the dashboard with `isDashboardRunning(port)` before mutating local state. When the dashboard responds, the CLI SHALL POST `/api/restart` (passing `{dev}` to match the requested mode), then exit zero. When the dashboard does not respond, the CLI SHALL fall back to the existing `cmdStop()` + `cmdStart()` sequence.

#### Scenario: dashboard up — CLI delegates

- **GIVEN** a dashboard server is running on the configured port
- **WHEN** the user runs `pi-dashboard restart`
- **THEN** the CLI SHALL POST `/api/restart` to the running server
- **AND** the CLI SHALL NOT call `cmdStop()` directly
- **AND** the CLI SHALL exit zero on a 2xx response

#### Scenario: dashboard down — CLI uses local fallback

- **GIVEN** no dashboard server is running on the configured port
- **WHEN** the user runs `pi-dashboard restart`
- **THEN** the CLI SHALL fall back to `cmdStop()` (no-op) followed by `cmdStart(config)`

### Requirement: Restart orchestrator terminates the previous daemon explicitly

The detached orchestrator spawned by `restart-helper.ts` SHALL read the dashboard PID file and, when the recorded PID is alive, send `SIGTERM` and wait up to 3 seconds for exit before sending `SIGKILL`. The orchestrator SHALL then poll for the port to be free before spawning the new server.

#### Scenario: stale daemon does not block the new spawn

- **GIVEN** the previous server is unresponsive but its process is still alive holding the listening port
- **WHEN** the orchestrator runs
- **THEN** the orchestrator SHALL terminate the previous PID (SIGTERM, then SIGKILL after 3 s)
- **AND** the orchestrator SHALL spawn the new server within 5 s of termination
