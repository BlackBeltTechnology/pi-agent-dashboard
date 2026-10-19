## Purpose

PID file tracking and CLI subcommands (start/stop/restart/status) for managing the dashboard server as a daemon process.

## Requirements

### Requirement: PID file tracking
The dashboard server SHALL write its process ID to `~/.pi/dashboard/server.pid` after it has successfully bound its HTTP port, and SHALL remove the file on graceful shutdown (SIGTERM, SIGINT, or `/api/shutdown`). A server that fails to bind SHALL NOT write the PID file.

No CLI command SHALL remove the PID file while the process it names is alive, even when that process does not answer the health check. The PID file is removed by a CLI command only when the named process is not alive.

#### Scenario: PID file created on startup
- **WHEN** the dashboard server starts in foreground mode and binds its HTTP port
- **THEN** it SHALL write the current `process.pid` to `~/.pi/dashboard/server.pid`

#### Scenario: Failed bind writes no PID file
- **WHEN** the dashboard server starts in foreground mode and its HTTP port bind fails (e.g. `EADDRINUSE`)
- **THEN** it SHALL NOT write or overwrite `~/.pi/dashboard/server.pid`

#### Scenario: PID file removed on graceful shutdown
- **WHEN** the server receives SIGTERM, SIGINT, or a `/api/shutdown` request
- **THEN** it SHALL remove `~/.pi/dashboard/server.pid` before exiting

#### Scenario: Stale PID file on startup
- **WHEN** the server starts and a PID file already exists but the process is not alive
- **THEN** it SHALL overwrite the PID file with the new process ID once its port is bound

#### Scenario: Slow health check keeps the PID file of a live process
- **WHEN** a CLI command reads `server.pid`, the named process is alive, and `/api/health` does not answer within the probe budget (e.g. the server is frozen with `SIGSTOP` or its event loop is blocked)
- **THEN** `server.pid` SHALL still exist after the command
- **AND** its content SHALL be unchanged

#### Scenario: PID file of a dead process is cleaned up
- **WHEN** a CLI command reads `server.pid` and the named process is not alive
- **THEN** the command SHALL remove `server.pid`

### Requirement: Start subcommand
The `pi-dashboard start` command SHALL launch the server as a detached background daemon, and SHALL confirm the launch via an identity-verified health check before returning.

Before launching, `start` SHALL classify the resolved dashboard port, probing `/api/health` on both loopback addresses (`127.0.0.1` and `::1`), and also on the configured bind host when that is a specific non-loopback address. A dashboard answering on any probed address is classified before the port can count as free. The probe SHALL use a bounded retry budget so that a single slow answer is not read as "not running". `start` SHALL act on the first matching row:

| Port state | Output | Exit | Spawns |
|---|---|---|---|
| A dashboard answers and the current HOME owns it | `Dashboard server is already running (pid N)` | 0 | no |
| A dashboard answers and the current HOME cannot prove it owns it | a line naming the port and the pid and stating the dashboard is `not owned by this HOME` | 1 | no |
| A non-dashboard service answers | the existing port-conflict message | 1 | no |
| Something holds the port but no attempt within the budget gets a definitive answer (timeout, reset) | a line containing `running but not responding (pid N)`; the pid comes from this HOME's lock metadata for this port and is omitted when there is none | 1 | no |
| The port is refused, and this HOME's lock metadata names a live pid for this port whose `startedAt` is within the start grace (30 s) | `Dashboard server is starting (pid N)` | 0 | no |
| The port is refused (any other case, including a live but unrelated pid in a stale `server.pid`) | launch | — | yes |

The current HOME owns an answering dashboard by the same evidence that `stop` uses ("Stop port sweep is scoped to the current HOME"), when either holds:
- `/api/health` reports an `instanceId` equal to the id persisted under the current HOME for the resolved gateway port;
- the current HOME's lock metadata records the reported pid and the resolved dashboard port.

`server.pid` alone SHALL NOT prove ownership, because PIDs are reused across HOMEs.

Classifying ownership SHALL NOT create or modify an instance-id file, lock file, lock metadata or PID file.

After a launch, `start` SHALL print `Dashboard server started (pid N)` only when a post-readiness classification of the port (full retry budget) finds an owned dashboard that reports the pid of the process this command spawned. When that classification reports anything else while the spawned process is still alive, `start` SHALL terminate the spawned process before reporting, so it never leaves a second, unconfirmed server behind. When the spawned process exits early, whatever its exit code, `start` SHALL classify the port once more. If an owned or starting dashboard answers, `start` SHALL report that verdict with exit code 0. Otherwise it SHALL report the launch failure, point to the server log, and exit with code 1.

#### Scenario: Start when not running
- **WHEN** a user runs `pi-dashboard start` and the dashboard port is refused
- **THEN** the server SHALL be spawned as a detached process and the command SHALL print the server URL and exit with code 0

#### Scenario: Start when already running
- **WHEN** a user runs `pi-dashboard start` and a dashboard owned by the current HOME is running
- **THEN** the command SHALL print "Dashboard server is already running (pid NNN)" and exit with code 0
- **AND** it SHALL NOT spawn a process

#### Scenario: Healthy dashboard without a PID file counts as running
- **WHEN** a dashboard owned by the current HOME answers `/api/health` on the resolved port
- **AND** `~/.pi/dashboard/server.pid` is missing
- **AND** a user runs `pi-dashboard start`
- **THEN** the command SHALL print "Dashboard server is already running (pid N)", where N is the pid that `/api/health` reports
- **AND** it SHALL exit with code 0 without spawning a process

#### Scenario: Dashboard of another HOME on the port is refused
- **WHEN** a dashboard started under HOME A answers on the resolved port
- **AND** a user runs `pi-dashboard start` under HOME B on that same port, and none of B's ownership evidence matches it
- **THEN** the command SHALL print a line naming the port and A's dashboard pid, stating it is `not owned by this HOME`
- **AND** it SHALL exit with code 1 without spawning a process

#### Scenario: Frozen dashboard is refused, not replaced
- **WHEN** the current HOME's dashboard process is alive but frozen (e.g. `SIGSTOP`), so its port accepts connections and `/api/health` never answers
- **AND** a user runs `pi-dashboard start`
- **THEN** the command SHALL print a line containing `running but not responding (pid N)`
- **AND** it SHALL exit with code 1 without spawning a process
- **AND** `server.pid` and the lock metadata SHALL be unchanged

#### Scenario: A slow first answer is not "not running"
- **WHEN** the current HOME's dashboard answers `/api/health` only after the first probe attempt has timed out but within the retry budget
- **AND** a user runs `pi-dashboard start`
- **THEN** the command SHALL report "already running" and SHALL NOT spawn a process

#### Scenario: A launch that loses to an existing dashboard is not reported as started
- **WHEN** `pi-dashboard start` spawns a process
- **AND** the dashboard that answers the readiness check reports a pid other than the spawned process's pid
- **THEN** the command SHALL NOT print "Dashboard server started"
- **AND** it SHALL print the result of classifying the port again (e.g. "Dashboard server is already running (pid N)")

#### Scenario: A stale PID file naming an unrelated live process does not block start
- **WHEN** `server.pid` names a pid that is alive but belongs to an unrelated process (e.g. after a reboot)
- **AND** the resolved dashboard port is refused and no lock metadata of this HOME names a live pid for it
- **THEN** `pi-dashboard start` SHALL launch the server and exit with code 0 once it is healthy

#### Scenario: A dashboard still starting is not launched twice
- **WHEN** this HOME's lock metadata names a live pid for the resolved port, its `startedAt` is within 30 s, and the port is refused
- **AND** a user runs `pi-dashboard start`
- **THEN** the command SHALL print "Dashboard server is starting (pid N)" and exit with code 0 without spawning a process

#### Scenario: A crashing launch is reported as a failure
- **WHEN** `pi-dashboard start` spawns a process that exits early
- **AND** no owned or starting dashboard answers on the port afterwards
- **THEN** the command SHALL print a launch-failure message pointing to the server log and exit with code 1
- **AND** it SHALL NOT print "Dashboard server started" or "already running"

#### Scenario: A launch that loses the bind race to this HOME's dashboard
- **WHEN** the pre-launch classification found the port free, but another start of this HOME binds it first
- **AND** the spawned process exits on its bind failure
- **THEN** `pi-dashboard start` SHALL print "Dashboard server is already running (pid N)" (or "starting") and exit with code 0

#### Scenario: Start with flags
- **WHEN** a user runs `pi-dashboard start --port 3000 --pi-port 3001`
- **THEN** the detached server SHALL use the specified ports

#### Scenario: Start fails
- **WHEN** a user runs `pi-dashboard start` and the spawned server does not pass the readiness health check within 30 seconds (pre-launch classification and post-readiness confirmation are not counted)
- **THEN** the command SHALL print an error message and exit with code 1

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

### Requirement: Restart subcommand
The `pi-dashboard restart` command SHALL stop the running server (if any) and start a new one.

#### Scenario: Restart when running
- **WHEN** a user runs `pi-dashboard restart`
- **THEN** it SHALL stop the current server and start a new one

#### Scenario: Restart when not running
- **WHEN** a user runs `pi-dashboard restart` and no server is running
- **THEN** it SHALL start a new server (equivalent to `start`)

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

### Requirement: Health endpoint
The dashboard server SHALL expose a `GET /api/health` endpoint that returns server liveness information.

#### Scenario: Health check
- **WHEN** a `GET /api/health` request is received
- **THEN** the server SHALL respond with `{ ok: true, pid: <number>, uptime: <seconds> }`

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

### Requirement: mDNS as primary discovery for CLI status
The `pi-dashboard status` command SHALL query mDNS first, but only a local record whose port equals the resolved dashboard port SHALL be considered. The record contributes the reported hostname. The verdict and exit code always come from classifying the resolved port. A matching record whose health does not answer SHALL NOT be reported as running.

#### Scenario: Status finds server via mDNS
- **WHEN** `pi-dashboard status` is run, a local server advertising on mDNS uses the resolved dashboard port, and the port classifies as an owned dashboard
- **THEN** it SHALL report the server as running with hostname and port from the mDNS record

#### Scenario: mDNS record on another port is ignored
- **WHEN** `pi-dashboard status --port 18555` is run and the only local mDNS record advertises port 8000
- **THEN** that record SHALL be ignored and the verdict SHALL come from classifying port 18555

#### Scenario: mDNS record whose health does not answer
- **WHEN** a local mDNS record matches the resolved port but `/api/health` gets no definitive answer
- **THEN** the command SHALL NOT print "running" or "discovered via mDNS" with exit code 0
- **AND** it SHALL report the classifier verdict (`running but not responding`, exit 1)

#### Scenario: Status falls back to PID file
- **WHEN** `pi-dashboard status` is run and mDNS returns no matching results
- **THEN** it SHALL classify the resolved port, using the PID file and lock metadata as pid sources

### Requirement: Stop port sweep is scoped to the current HOME
`pi-dashboard stop` SHALL evaluate ownership evidence before the PID-file step terminates anything. After the PID-file step it SHALL inspect the processes listening on the resolved dashboard and gateway TCP ports. A pid that the PID-file step actually stopped is not inspected again. A PID-file pid the step failed to stop is inspected like any other listener. It SHALL terminate a listener only when the current `HOME` proves it owns it. Ownership is proven when either of the following holds:
- the single-instance lock metadata in the current HOME's dashboard directory records that listener's pid **and** records the resolved dashboard port as its HTTP port. The metadata SHALL be read from the same location that a server started under the current `HOME` writes it to;
- the dashboard's `/api/health`, probed on the resolved dashboard port, reports an `instanceId` equal to the instance id persisted under the current HOME for the resolved gateway port, **and** the `pid` it reports equals the listener's pid.

The server PID file is advisory and SHALL NOT, on its own, prove ownership of a port listener. The existing PID-file termination step is unchanged.

A listener that meets neither condition SHALL be left running. The command SHALL print one line per such listener, naming every swept port it holds, the pid and the current HOME's dashboard directory, and pointing to `--force`. A listener holding both ports SHALL be acted on or reported once. Evaluating ownership SHALL NOT create or modify an instance-id file, lock file, lock metadata or PID file. If ownership evidence is missing or unreadable, or the health probe fails or times out, the listener SHALL be treated as not owned. Skipping a non-owned listener SHALL NOT change the exit code.

#### Scenario: Foreign HOME outside the temp dir does not kill the live dashboard
- **WHEN** a dashboard owned by HOME A listens on port 8000
- **AND** `pi-dashboard stop` runs with `HOME` set to an empty directory B that is not under the OS temp dir, with no port flags
- **THEN** the dashboard owned by A SHALL keep running
- **AND** the output SHALL report port 8000 as held by that pid and not owned by B, with a `--force` hint
- **AND** the command SHALL exit with code 0

#### Scenario: Temp HOME stops its own dashboard
- **WHEN** a dashboard started with `HOME=B --port 18555 --pi-port 18556` is running
- **AND** `pi-dashboard stop --port 18555 --pi-port 18556` runs with `HOME=B`
- **THEN** that dashboard SHALL be stopped
- **AND** any dashboard owned by another HOME on other ports SHALL be unaffected

#### Scenario: Orphan owned via lock metadata
- **WHEN** the current HOME's PID file is missing
- **AND** the process listening on the dashboard port has the pid that the current HOME's lock metadata records for that HTTP port
- **THEN** `pi-dashboard stop` SHALL terminate that process

#### Scenario: Lock metadata for a different port does not prove ownership
- **WHEN** the current HOME's lock metadata records the listener's pid but a different HTTP port than the resolved dashboard port
- **AND** no health proof matches
- **THEN** the listener SHALL be treated as not owned and left running

#### Scenario: PID file alone does not prove ownership of a port listener
- **WHEN** the current HOME's PID file names a live pid that the PID-file step did not stop
- **AND** that pid listens on the dashboard port without matching lock metadata or health identity
- **THEN** the port sweep SHALL treat it as not owned and report it

#### Scenario: Owned via health identity
- **WHEN** the lock metadata does not name the listener
- **AND** the dashboard port's `/api/health` reports this HOME's persisted `instanceId` and the listener's pid
- **THEN** `pi-dashboard stop` SHALL terminate that process

#### Scenario: Matching instanceId but different pid
- **WHEN** `/api/health` reports this HOME's `instanceId` but a `pid` other than the listener's pid
- **THEN** the listener SHALL be treated as not owned and left running

#### Scenario: Ownership check does not create identity state
- **WHEN** `pi-dashboard stop` runs under a HOME that has no `instances/` directory
- **THEN** after the command, no instance-id file SHALL exist under that HOME

#### Scenario: Unattributable non-dashboard listener
- **WHEN** a service that is not a dashboard listens on the dashboard port and no ownership proof matches it
- **THEN** `pi-dashboard stop` SHALL leave it running and report it

### Requirement: Forced stop override
`pi-dashboard stop --force` SHALL terminate every listener on the resolved dashboard and gateway TCP ports, regardless of ownership. Before terminating each swept listener it could not attribute to the current HOME, it SHALL print a warning naming the port(s) and pid. `--force` SHALL NOT change the PID-file step. The CLI usage documentation and the README command reference SHALL describe `--force` as dangerous: it can terminate a dashboard owned by another HOME or user, an Electron-owned dashboard, or an unrelated service bound to the same port. They SHALL also say it is meant only to recover an orphaned listener that cannot be attributed otherwise.

#### Scenario: Force kills a foreign listener
- **WHEN** a dashboard owned by HOME A listens on port 8000
- **AND** `pi-dashboard stop --force` runs with `HOME=B`, where B is not under the OS temp dir
- **THEN** that listener SHALL be terminated
- **AND** the output SHALL include a warning that the terminated pid was not owned by B

#### Scenario: Force still kills owned listeners silently
- **WHEN** `pi-dashboard stop --force` runs and the only listener is owned by the current HOME
- **THEN** the listener SHALL be terminated without the not-owned warning

#### Scenario: Force does not widen the resolved ports
- **WHEN** `pi-dashboard stop --force` runs with `HOME` under the OS temp dir, either with no port flags or with `--port 8000`
- **THEN** port 8000 SHALL NOT be inspected

#### Scenario: Usage documentation states the danger
- **WHEN** a user reads the CLI usage block or the README command reference for `stop`
- **THEN** `--force` SHALL be listed with a warning that it can kill a dashboard or service not owned by the current HOME
