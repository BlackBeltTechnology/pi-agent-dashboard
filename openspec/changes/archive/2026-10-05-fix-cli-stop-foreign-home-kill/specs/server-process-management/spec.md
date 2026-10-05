## MODIFIED Requirements

### Requirement: Stop subcommand
The `pi-dashboard stop` command SHALL gracefully stop a running dashboard server by sending SIGTERM to the process identified by the PID file. The command SHALL resolve the dashboard port and the pi gateway port exactly as `start` resolves the ports it would bind: `--port` / `--pi-port` flags first, then `PI_DASHBOARD_PORT` / `PI_DASHBOARD_PI_PORT`, then the configuration file of the current `HOME`, then the defaults. This includes the temp-HOME production-port guard, but `stop` SHALL NOT print that guard's bind-refusal warning, because it binds nothing. A resolved port of `0` SHALL NOT be inspected. A server that bound an OS-assigned port is therefore stopped only by the PID-file step.

#### Scenario: Stop when running
- **WHEN** a user runs `pi-dashboard stop` and the server is running
- **THEN** it SHALL send SIGTERM to the server process, wait for exit (up to 5 seconds), and print "Dashboard server stopped"

#### Scenario: Stop when not running
- **WHEN** a user runs `pi-dashboard stop` and no server is running
- **THEN** it SHALL print "Dashboard server is not running" and exit with code 0

#### Scenario: Stop with stale PID
- **WHEN** a user runs `pi-dashboard stop` and the PID file exists but the process is dead
- **THEN** it SHALL remove the stale PID file and print a line beginning "Dashboard server is not running"

#### Scenario: Stop honors explicit ports
- **WHEN** a user runs `pi-dashboard stop --port 18555 --pi-port 18556`
- **THEN** the port check SHALL inspect only ports 18555 and 18556
- **AND** it SHALL NOT inspect the configured or default ports (8000 / 9999)

#### Scenario: Temp HOME under the OS temp dir never inspects the production port
- **WHEN** `pi-dashboard stop` runs with `HOME` set to a directory under the OS temp dir, with or without `--port 8000`
- **THEN** port 8000 SHALL NOT be inspected, because `start` under that HOME can never bind it
- **AND** a dashboard listening on 8000 SHALL keep running

## ADDED Requirements

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
