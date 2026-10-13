## MODIFIED Requirements

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
The `pi-dashboard stop` command SHALL gracefully stop a running dashboard server by sending SIGTERM to the process identified by the PID file. The command SHALL resolve the dashboard port and the pi gateway port exactly as `start` resolves the ports it would bind: `--port` / `--pi-port` flags first, then `PI_DASHBOARD_PORT` / `PI_DASHBOARD_PI_PORT`, then the configuration file of the current `HOME`, then the defaults. This includes the temp-HOME production-port guard, but `stop` SHALL NOT print that guard's bind-refusal warning, because it binds nothing. A resolved port of `0` SHALL NOT be inspected. A server that bound an OS-assigned port is therefore stopped only by the PID-file step. After the PID-file step, `stop` SHALL remove the PID file only when the process it names is no longer alive.

#### Scenario: Stop when running
- **WHEN** a user runs `pi-dashboard stop` and the server is running
- **THEN** it SHALL send SIGTERM to the server process, wait for exit (up to 5 seconds), and print "Dashboard server stopped"

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

### Requirement: Status subcommand
The `pi-dashboard status` command SHALL report the state of the resolved dashboard port (from `--port`, then `PI_DASHBOARD_PORT`, then config, then the default; gateway port resolved the same way), using the same port classification and ownership rules as `start`. It SHALL NOT report a dashboard listening on a different port as the running server. Classification SHALL NOT create or modify an instance-id file, lock file, lock metadata or PID file.

| Port state | Output | Exit |
|---|---|---|
| Owned dashboard answers | `Dashboard server is running (pid N) on port P` | 0 |
| Dashboard still starting | `Dashboard server is starting (pid N)` | 0 |
| Dashboard not owned by this HOME | a line naming the port and pid, stating `not owned by this HOME` | 1 |
| Non-dashboard service | the port-conflict message | 1 |
| Held but no definitive answer | a line containing `running but not responding (pid N)` | 1 |
| Refused | `Dashboard server is not running` | 1 |

#### Scenario: Status when running
- **WHEN** a user runs `pi-dashboard status` and a dashboard owned by the current HOME is running on the resolved port
- **THEN** it SHALL print "Dashboard server is running (pid NNN) on port PPPP" and exit with code 0

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
