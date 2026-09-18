# server-restart

## Purpose

Defines the protocol and lifecycle invariants for restarting and shutting down the pi-dashboard server without racing connected pi bridges. Covers the `server_restarting` broadcast contract, bridge auto-start quiesce behaviour, CLI delegation to `/api/restart`, and the detached orchestrator's responsibility for terminating the previous daemon before spawning a new one.

## Requirements

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

### Requirement: Restart orchestrator preserves the bound port

The detached orchestrator built by `restart-helper.ts:buildOrchestratorScript` SHALL serialize the parent process's actually-bound HTTP port (received as `params.port`) into the new child's CLI args as `--port <n>`. The injection SHALL apply to BOTH argv-construction branches of `spawnArgs`:

- The `--import` loader branch (`buildNodeImportArgvParts`).
- The bare-entry branch (no loader).

The `--port` flag SHALL be placed AFTER `"start"` and BEFORE any `...params.extraArgs` so that callers passing their own `--port` in `extraArgs` can override the structural value (left-to-right argv semantics in `cli.ts:parseArgs`).

The orchestrator's `PORT` constant (used by `portFree` and `healthOk` polling) SHALL remain `params.port` so the port polled for health is identical to the port the new child is told to bind.

#### Scenario: Loader branch — `--port` injected after `start` and before extraArgs

- **WHEN** `buildOrchestratorScript({ cliPath, loader: "file:///loader.mjs", port: 8001, extraArgs: ["--dev"] })` is called
- **THEN** the embedded spawn args SHALL include `"start"`, `"--port"`, `"8001"`, `"--dev"` in that relative order
- **AND** the embedded `PORT` constant SHALL equal `8001`

#### Scenario: Bare-entry branch — `--port` injected after `start` and before extraArgs

- **WHEN** `buildOrchestratorScript({ cliPath, loader: "", port: 8001, extraArgs: ["--dev"] })` is called
- **THEN** the embedded spawn args SHALL include `"start"`, `"--port"`, `"8001"`, `"--dev"` in that relative order

#### Scenario: Caller-supplied --port in extraArgs overrides the structural port

- **WHEN** `buildOrchestratorScript({ cliPath, loader: "", port: 8001, extraArgs: ["--port", "9000"] })` is called
- **THEN** the embedded spawn args SHALL include `"--port"`, `"8001"`, `"--port"`, `"9000"` in that relative order
- **AND** `cli.ts:parseArgs` left-to-right semantics SHALL cause the child to bind on `9000` (the last value wins)

#### Scenario: Restarted server preserves non-default bind port end-to-end

- **GIVEN** a dashboard server was started with `--port 8001` (`config.port === 8001`)
- **AND** `~/.pi/dashboard/config.json` contains the default `port: 8000`
- **WHEN** `POST :8001/api/restart` is invoked
- **THEN** the replacement child SHALL bind on `8001` (not `8000`)
- **AND** `/api/health` SHALL respond on `8001` after the orchestrator's health-polling window

### Requirement: A changed server heap ceiling requires a cold start

The in-place restart path re-launches the server with the current process's
environment. A changed `serverHeap.maxOldSpaceMb` therefore SHALL NOT take
effect across an in-place restart; the restarted server SHALL keep the ceiling
the replaced process was running under.

This is a documented consequence of environment inheritance, not a defect to
work around: the environment is inherited deliberately so the restarted server
keeps its ambient configuration.

The restart SHALL NOT report the new ceiling as applied, and the surface that
offers the setting SHALL state the cold-start requirement.

#### Scenario: In-place restart keeps the previous ceiling
- **WHEN** `serverHeap.maxOldSpaceMb` is changed and an in-place restart is triggered
- **THEN** the restarted server SHALL run under the previous ceiling

#### Scenario: Cold start adopts the new ceiling
- **WHEN** the server is stopped and started afresh after the change
- **THEN** it SHALL run under the newly configured ceiling

#### Scenario: Restart does not misreport the change as applied
- **WHEN** an in-place restart completes after a `serverHeap` change
- **THEN** the dashboard SHALL NOT indicate that the new ceiling is in effect
