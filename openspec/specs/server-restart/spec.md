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

The bridge SHALL interpret `quiesceMs` as follows, in this order. A value that is not a number, or is `NaN`, SHALL be ignored (no pause is started). A non-integer value SHALL be rounded up (ceiling) to an integer, never down, so the floor below is preserved. A result that is zero or negative SHALL be ignored. A value above 120000 ms (the maximum the bridge honours), including `Infinity`, SHALL be clamped to 120000 rather than honoured in full or dropped. The "at least `quiesceMs`" floor SHALL hold for every accepted value up to and including 120000 ms. The 120000 ms bound and the ignore rules SHALL apply to every request to pause auto-start, regardless of which caller makes it (the `server_restarting` handler, an inbound dispatch path, or any other code path); no caller SHALL be able to pause auto-start beyond the bound. When pauses overlap, the pause deadline SHALL be the later of the existing and the new deadline; a new pause SHALL never shorten an active one.

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

#### Scenario: Shutdown-sized quiesce is honoured in full

- **GIVEN** a bridge that receives `server_restarting { reason: "shutdown", quiesceMs: 60000 }`
- **WHEN** auto-start is attempted 59 seconds after receipt
- **THEN** the bridge SHALL NOT spawn a server

#### Scenario: Absurdly large quiesce is clamped

- **GIVEN** a bridge that receives `server_restarting { quiesceMs: 1e15 }`
- **WHEN** auto-start is attempted 121 seconds after receipt and the dashboard is still unreachable
- **THEN** the auto-start spawn step SHALL execute

#### Scenario: Infinite quiesce is clamped, not ignored

- **GIVEN** a bridge that receives `server_restarting { quiesceMs: Infinity }`
- **WHEN** auto-start is attempted 121 seconds after receipt and the dashboard is still unreachable
- **THEN** the auto-start spawn step SHALL execute

#### Scenario: Non-integer quiesce is rounded up

- **GIVEN** a bridge that receives `server_restarting { quiesceMs: 5000.2 }`
- **WHEN** auto-start is attempted 5000.5 milliseconds after receipt
- **THEN** the bridge SHALL NOT spawn a server, because the pause is 5001 ms
- **AND** a `quiesceMs` of `-0.5` SHALL start no pause

#### Scenario: Bound applies regardless of caller

- **GIVEN** any caller, other than the `server_restarting` handler, requests an auto-start pause of `1e15` ms or `Infinity`
- **WHEN** auto-start is attempted 121 seconds after the request and the dashboard is still unreachable
- **THEN** the auto-start spawn step SHALL execute
- **AND** a non-positive, `NaN` or non-number pause request from that caller SHALL start no pause

#### Scenario: Overlapping pauses never shorten the deadline
- **GIVEN** a bridge that received `server_restarting { quiesceMs: 60000 }` and then receives `server_restarting { quiesceMs: 5000 }` 1 second later
- **WHEN** auto-start is attempted 30 seconds after the first receipt
- **THEN** the bridge SHALL NOT spawn a server
- **AND** a later, longer pause SHALL extend the deadline to the later value

#### Scenario: Invalid quiesce is ignored

- **WHEN** a bridge receives `server_restarting` with `quiesceMs` of `0`, a negative number, `NaN`, or a non-number
- **THEN** the bridge SHALL NOT start or extend an auto-start pause from that message

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
