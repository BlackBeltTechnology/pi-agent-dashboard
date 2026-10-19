## MODIFIED Requirements

### Requirement: Stop subcommand
The `pi-dashboard stop` command SHALL gracefully stop a running dashboard server owned by the current HOME. When the health reply gathered before anything is terminated proves the dashboard on the resolved port is owned by the current HOME (instance-id match), the first termination of the pid that reply reports SHALL be a deliberate shutdown request through that dashboard's loopback `POST /api/shutdown`. This applies whether that pid is the PID-file pid or an owned port-sweep listener. The request SHALL carry the same per-request local credential the CLI sends to `/api/restart`, so it is accepted under `requireLocalProof`. It SHALL NOT declare a user quit, so the server records the exit intent `"shutdown"`. That endpoint announces the shutdown to connected bridges, so they do not auto-start a replacement during the quiesce window. `stop` SHALL then wait for the process to exit, within the same bound as today, and on success print the same "stopped" line as the signal path. Owned listeners whose ownership rests on lock metadata alone (no health proof for their pid) keep using termination signals and are not announced. When the request fails, is refused, or the process is still alive after the wait, and in every case without such a health proof, `stop` SHALL fall back to sending SIGTERM to the process identified by the PID file, as today. The command SHALL resolve the dashboard port and the pi gateway port exactly as `start` resolves the ports it would bind: `--port` / `--pi-port` flags first, then `PI_DASHBOARD_PORT` / `PI_DASHBOARD_PI_PORT`, then the configuration file of the current `HOME`, then the defaults. This includes the temp-HOME production-port guard, but `stop` SHALL NOT print that guard's bind-refusal warning, because it binds nothing. A resolved port of `0` SHALL NOT be inspected. A server that bound an OS-assigned port is therefore stopped only by the PID-file step. After the PID-file step, `stop` SHALL remove the PID file only when the process it names is no longer alive.

A server started by the pi-dashboard desktop app is stopped like any other server owned by the current HOME. When the health reply gathered before anything is terminated reports `launchSource: "electron"` and `bootParentAlive: true`, and `stop` did stop that server, `stop` SHALL also print a note. The note SHALL say the desktop app started the server, name the app's pid (`bootParentPid`), and state that the app stays open and shows its reconnect page, where Start server brings the server back or the app can be quit. The note SHALL NOT change the exit code. Without such a health reply (unreachable, or not electron, or the app not alive) no note is printed.

#### Scenario: Stop when running
- **WHEN** a user runs `pi-dashboard stop` and the server is running
- **THEN** it SHALL stop the server process (shutdown request, else SIGTERM), wait for exit (up to 5 seconds), and print "Dashboard server stopped"

#### Scenario: Stop announces the shutdown to connected bridges
- **WHEN** a dashboard runs on the resolved port, its `/api/health` reports the current HOME's persisted instance id for the resolved gateway port, and a non-pinned pi bridge is connected to it
- **AND** a user runs `pi-dashboard stop`, with no other dashboard start running concurrently
- **THEN** the dashboard SHALL receive a `POST /api/shutdown` before any signal is sent to its pid
- **AND** the bridge SHALL NOT start a replacement dashboard within the announced quiesce window
- **AND** after the command returns, no dashboard SHALL answer on the resolved port

#### Scenario: Orphan proven by health identity is stopped by request
- **WHEN** the current HOME's PID file is missing and the dashboard port's `/api/health` reports this HOME's persisted instance id and the listener's pid
- **THEN** `stop` SHALL stop that listener through `POST /api/shutdown`, falling back to a termination signal as for the PID-file pid

#### Scenario: Shutdown request fails and stop falls back to SIGTERM
- **WHEN** the `POST /api/shutdown` request errors, or is refused, or the process is still alive after the wait
- **THEN** `stop` SHALL send SIGTERM to the PID-file process as before
- **AND** the remaining stop behaviour (PID-file removal rule, port sweep) SHALL be unchanged

#### Scenario: No health proof uses SIGTERM
- **WHEN** no persisted instance id exists for the resolved gateway port, or `/api/health` does not answer before anything is terminated
- **THEN** `stop` SHALL NOT send a shutdown request and SHALL use SIGTERM on the PID-file process

#### Scenario: Shutdown-request stop records the shutdown intent
- **WHEN** `stop` stopped the server through the shutdown request
- **THEN** the server's boot record SHALL hold exit intent `"shutdown"`, not `"user-quit"`

#### Scenario: SIGTERM-fallback stop records the signal intent
- **WHEN** `stop` stopped the server through the SIGTERM fallback
- **THEN** the boot record SHALL hold exit intent `"signal"`, as today

#### Scenario: Shutdown request under requireLocalProof
- **WHEN** the dashboard runs with `requireLocalProof` enabled and `stop` sends the shutdown request
- **THEN** the request SHALL be accepted and the server SHALL exit through `/api/shutdown`, not through the SIGTERM fallback

#### Scenario: Stop when not running
- **WHEN** a user runs `pi-dashboard stop` and no server is running
- **THEN** it SHALL print "Dashboard server is not running" and exit with code 0

#### Scenario: Stop with stale PID
- **WHEN** a user runs `pi-dashboard stop` and the PID file exists but the process is dead
- **THEN** it SHALL remove the stale PID file and print a line beginning "Dashboard server is not running"

#### Scenario: Stop that fails to terminate keeps the PID file
- **WHEN** a user runs `pi-dashboard stop` and the process named by the PID file is still alive after the termination attempt
- **THEN** `server.pid` SHALL be left unchanged

#### Scenario: Stop honors explicit ports
- **WHEN** a user runs `pi-dashboard stop --port 18555 --pi-port 18556`
- **THEN** the port check SHALL inspect only ports 18555 and 18556
- **AND** it SHALL NOT inspect the configured or default ports (8000 / 9999)

#### Scenario: Temp HOME under the OS temp dir never inspects the production port
- **WHEN** `pi-dashboard stop` runs with `HOME` set to a directory under the OS temp dir, with or without `--port 8000`
- **THEN** port 8000 SHALL NOT be inspected, because `start` under that HOME can never bind it
- **AND** a dashboard listening on 8000 SHALL keep running

#### Scenario: Stop a server owned by the open desktop app
- **WHEN** the pi-dashboard desktop app is running and the server it started for the current HOME answers on the resolved port with the current HOME's instance id, `launchSource: "electron"`, `bootParentAlive: true` and `bootParentPid: A`
- **AND** a user runs `pi-dashboard stop` under the same HOME
- **THEN** that server SHALL be stopped and "Dashboard server stopped" printed
- **AND** a note SHALL be printed naming the desktop app (pid A) as the server's starter and stating the app will show its reconnect page (Start server, or quit the app)
- **AND** the command SHALL exit with code 0

#### Scenario: Stop a server whose desktop app is gone
- **WHEN** the server on the resolved port reports `launchSource: "electron"` and `bootParentAlive: false`
- **AND** a user runs `pi-dashboard stop` under the owning HOME
- **THEN** that server SHALL be stopped
- **AND** no reconnect-page note SHALL be printed

#### Scenario: Stop a CLI-started server prints no app note
- **WHEN** the server on the resolved port reports `launchSource: "standalone"`
- **AND** a user runs `pi-dashboard stop`
- **THEN** the output SHALL NOT mention the desktop app

### Requirement: Status subcommand
The `pi-dashboard status` command SHALL report the state of the resolved dashboard port (from `--port`, then `PI_DASHBOARD_PORT`, then config, then the default; gateway port resolved the same way), using the same port classification and ownership rules as `start`. It SHALL NOT report a dashboard listening on a different port as the running server. Classification SHALL NOT create or modify an instance-id file, lock file, lock metadata or PID file. A server started by the pi-dashboard desktop app under the current HOME is an owned dashboard like any other. When the owned dashboard's health reply reports `launchSource: "electron"`, the running line SHALL also state that the desktop app started it. When that reply also reports `bootParentAlive: false`, the line SHALL add that the app is no longer running.

| Port state | Output | Exit |
|---|---|---|
| Owned dashboard answers | `Dashboard server is running (pid N) on port P` (plus a desktop-app mention when `launchSource` is `electron`) | 0 |
| Dashboard still starting | `Dashboard server is starting (pid N)` | 0 |
| Dashboard not owned by this HOME | a line naming the port and pid, stating `not owned by this HOME` | 1 |
| Non-dashboard service | the port-conflict message | 1 |
| Held but no definitive answer | a line containing `running but not responding (pid N)` | 1 |
| Refused | `Dashboard server is not running` | 1 |

#### Scenario: Status when running
- **WHEN** a user runs `pi-dashboard status` and a dashboard owned by the current HOME is running on the resolved port
- **THEN** it SHALL print "Dashboard server is running (pid NNN) on port PPPP" and exit with code 0

#### Scenario: Status of a desktop-app-started server
- **WHEN** the pi-dashboard desktop app started the server for the current HOME, and that server answers on the resolved port with `launchSource: "electron"` and the current HOME's instance id
- **AND** a user runs `pi-dashboard status` under the same HOME
- **THEN** it SHALL print a line beginning "Dashboard server is running (pid NNN) on port PPPP" that also states the desktop app started it
- **AND** it SHALL exit with code 0

#### Scenario: Status of an orphaned desktop-app server
- **WHEN** the owned dashboard on the resolved port reports `launchSource: "electron"` and `bootParentAlive: false`
- **THEN** the running line SHALL state that the desktop app started it and is no longer running
- **AND** it SHALL exit with code 0

#### Scenario: Status when not running
- **WHEN** a user runs `pi-dashboard status` and the resolved port is refused
- **THEN** it SHALL print "Dashboard server is not running" and exit with code 1

#### Scenario: Status honours an explicit port
- **WHEN** a dashboard of another HOME runs on port 8000 and advertises on mDNS
- **AND** a user runs `pi-dashboard status --port 18555` under a temp HOME with no dashboard on 18555
- **THEN** it SHALL print "Dashboard server is not running" and exit with code 1
- **AND** it SHALL NOT mention port 8000

#### Scenario: Status of a same-port dashboard of another HOME
- **WHEN** a dashboard of HOME A answers on the resolved port
- **AND** a user runs `pi-dashboard status` under HOME B with no persisted instance id and no lock metadata for that port
- **THEN** it SHALL print a line stating the dashboard is `not owned by this HOME` and exit with code 1

#### Scenario: Status of a live but unresponsive server
- **WHEN** the resolved port accepts connections but `/api/health` gets no definitive answer within the probe budget
- **THEN** it SHALL print a line containing `running but not responding (pid N)` and exit with code 1
- **AND** `server.pid` and the lock metadata SHALL be unchanged

### Requirement: Backward compatible foreground mode
Running `pi-dashboard` with no subcommand SHALL continue to run the server in the foreground, as it does today. When foreground startup fails for any reason, the command SHALL classify the resolved port once, after the failure (no listener can be bound by a failed start, whichever listener failed first: the HTTP port or the pi gateway). When that classification finds a dashboard answering, or a non-dashboard service, it SHALL print the verdict `start` prints for that classification, including the desktop-app mention when the answering server reports `launchSource: "electron"`, instead of a generic start failure. Otherwise it SHALL print today's generic failure. The exit status SHALL be 1 in every such case, the same status a failed foreground start produces today, even where `start` would exit 0 for that verdict. No classification SHALL run before or during a successful startup, so a launch on a free port is not delayed.

#### Scenario: No subcommand runs foreground
- **WHEN** a user runs `pi-dashboard` (no subcommand)
- **THEN** the server SHALL start in the foreground, write the PID file, and block until terminated

#### Scenario: Foreground while the desktop app's server is running
- **WHEN** the pi-dashboard desktop app's server for the current HOME is serving the resolved port
- **AND** a user runs `pi-dashboard` (no subcommand) under the same HOME
- **THEN** it SHALL print "Dashboard server is already running (pid N)" together with a mention that the desktop app started it
- **AND** it SHALL NOT print a generic "Failed to start dashboard" error or stack trace
- **AND** it SHALL exit with status 1
- **AND** `server.pid`, the lock metadata and the instance-id file SHALL be unchanged

#### Scenario: Foreground on a port held by another service
- **WHEN** a non-dashboard service holds the resolved port
- **AND** a user runs `pi-dashboard` (no subcommand)
- **THEN** it SHALL print the port-conflict message `start` prints and exit with status 1

#### Scenario: Foreground fails for an unrelated reason
- **WHEN** foreground startup fails and the resolved port classifies as free
- **THEN** it SHALL print today's generic start-failure message and exit with status 1
