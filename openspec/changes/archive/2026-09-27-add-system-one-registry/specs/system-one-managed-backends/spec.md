## ADDED Requirements

### Requirement: Runtime detection
For each `managed` backend, the plugin server SHALL detect `uv` on PATH. When it is missing, the backend SHALL show status `unavailable`, with `uv` install guidance, and no process SHALL be spawned. Docker launch is out of scope for this change.

On `win32` every managed backend SHALL show status `unsupported-platform` in this change, and Start SHALL be disabled. Users MAY still point an `http` backend at a server they run themselves.

#### Scenario: Windows
- **WHEN** the dashboard runs on Windows
- **THEN** managed backends show `unsupported-platform` and no process is spawned

#### Scenario: No launcher
- **WHEN** `uv` is not on PATH
- **THEN** the backend shows `unavailable`, and Start is disabled

### Requirement: Start, stop and health
Install SHALL run `uv tool install <package>` with `UV_TOOL_DIR` and `UV_TOOL_BIN_DIR` set to directories under `~/.pi/agent/system-one/tools/`. Start SHALL then spawn the engine executable from that bin directory directly, so the child PID is the server itself. The spawn SHALL have no shell, SHALL use an argv array, and SHALL bind to `127.0.0.1` on the backend's port:
- Von (`von-sdk`): `<bin>/von serve --host 127.0.0.1 --port <port> --model <checkpoint>`;
- Laya (`laya[serve]`): `<bin>/laya-serve` with `LAYA_HOST=127.0.0.1`, `LAYA_PORT=<port>` and `LAYA_MODELS=<checkpoint>` in its environment. `laya-serve` takes no CLI flags; the checkpoint is also sent per request in the `model` field.

The package specifiers and flag spellings SHALL come from the plugin's catalog, pinned to verified versions.

Status SHALL move `starting` → `ready` once the health probe succeeds. The probe is `GET http://127.0.0.1:<port>/v1/models` returning 200 or, if that returns 404, a one-`noul` `POST /v1/systemone` returning a valid answer. This must happen with a 120 s budget that covers the first-run model download. Otherwise it SHALL move to `failed`, with the last 50 log lines retained. Stop SHALL send SIGTERM, then SIGKILL after 10 s. The status view SHALL show state, PID, RSS, uptime and the last health check time.

#### Scenario: First start downloads weights
- **WHEN** Start is pressed for Laya the first time
- **THEN** status is `starting` until `/v1/models` responds, then `ready`

#### Scenario: Engine crashes
- **WHEN** a `ready` managed process exits unexpectedly
- **THEN** status becomes `failed` and the adapter's next attempt on that backend fails fast with `error`

### Requirement: Port selection
When a managed backend has no port, the plugin SHALL choose the first free port in `18400–18499` and persist it to the config. The ports `8000`, `8080`, the dashboard's own listen port, and any port another backend in the config already uses SHALL never be chosen. A configured port that is busy at Start SHALL fail with status `failed` and reason `port-in-use`. It SHALL NOT silently move to another port.

#### Scenario: Default port collision avoided
- **WHEN** a Von backend is added with no port
- **THEN** its persisted port is in `18400–18499` and is not `8000`

### Requirement: Lifecycle bound to the dashboard
Managed processes SHALL be children of the dashboard server. They SHALL be stopped on server shutdown and on `/api/restart`. Each start SHALL write a PID file under `~/.pi/agent/system-one/run/` recording the PID, the process start time and the argv. On plugin start, a recorded process SHALL be terminated as an orphan only when it is alive AND its start time AND argv both equal the recorded values. Any other PID file SHALL be removed without signalling.

#### Scenario: PID reused by an unrelated process
- **WHEN** a PID file names a PID that now belongs to a different process with a different start time
- **THEN** that process is not signalled, and the PID file is removed Managed backends SHALL NOT be auto-started on server boot unless the backend has `autostart: true`.

#### Scenario: Orphan after crash
- **WHEN** the dashboard server was killed and restarted, and a `von serve` from the previous run is still alive with a matching PID file
- **THEN** the orphan is terminated before any new start
