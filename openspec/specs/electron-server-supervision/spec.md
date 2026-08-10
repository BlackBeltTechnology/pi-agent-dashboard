# electron-server-supervision Specification

## Purpose

Defines how the Electron app supervises the dashboard server: the user-initiated launch entry point (`requestServerLaunch`) with concurrent-call deduplication, phase-status events, a non-throwing outcome contract, and a force-restart flow; probing an identity-verified health endpoint to discover an already-running instance; spawning a new server from the bundled or dev-monorepo source when none is running while keeping the child inside Electron's process group; classifying startup failures for the correct recovery surface; and detecting and adopting orphaned zombie servers left over from a prior Electron lifetime. Also covers reading the per-HOME lock sidecar and registering the bundled bridge extension.

## Requirements

### Requirement: User-initiated server launch entry point

The app SHALL expose a single `requestServerLaunch` routine shared by the loading-page "Start server" button, tray menu items, and any future in-app launch controls, which SHALL be idempotent under concurrent invocation and SHALL support an optional force-restart.

#### Scenario: Concurrent calls share one launch
- **WHEN** `requestServerLaunch` is called while a prior launch is still in flight
- **THEN** the same in-flight launch promise is returned rather than starting a second launch
- **AND** the shared in-flight promise is cleared once the launch settles so a subsequent call can start a fresh launch

#### Scenario: Already running without force
- **WHEN** the health probe reports the server running on the configured port and `force` is not set
- **THEN** the routine emits the `ready` phase with the local URL and returns outcome `already-running` with that URL without spawning

#### Scenario: Force-restart an already-running server
- **WHEN** the health probe reports the server running and `force` is set
- **THEN** the routine emits the `shutting-down-existing` phase, POSTs to `/api/shutdown` on the running server (best effort, bounded by a 3-second timeout), then polls `/api/health` up to 5 seconds (200 ms interval) for the port to close before spawning a replacement
- **AND** a failed or unreachable shutdown request is swallowed and the flow proceeds to spawn

#### Scenario: Launch when nothing is running
- **WHEN** no server is reachable on the configured port
- **THEN** the routine emits `spawning`, delegates to the discover-or-launch resolution to spawn and await health, then emits `ready` with the resulting URL and returns outcome `started`

### Requirement: Launch-status phase events

The app SHALL emit ordered launch-status phase events to subscribers (loading page and tray) over the course of a `requestServerLaunch` call, via an `onLaunchStatus` subscription that returns an unsubscribe function.

#### Scenario: Phase progression on success
- **WHEN** a launch proceeds from request to a reachable server
- **THEN** subscribers receive `starting`, then (when spawning) `spawning` and `waiting-health`, and finally `ready` carrying the connect URL
- **AND** a force-restart of a running server additionally emits `shutting-down-existing` after `starting`

#### Scenario: Phase progression on failure
- **WHEN** the launch fails
- **THEN** subscribers receive a `failed` phase carrying the failure message

#### Scenario: Listener isolation
- **WHEN** a subscribed listener throws while handling a status event
- **THEN** the thrown error is suppressed and remaining listeners still receive the event

### Requirement: Non-throwing launch outcome contract

The `requestServerLaunch` routine SHALL never throw; every terminal condition SHALL be reported as a `LaunchOutcome` value, and failures SHALL carry a bounded tail of the server log.

#### Scenario: Failure returns a structured outcome
- **WHEN** the launch throws internally (spawn failure, resolution error, health timeout)
- **THEN** the routine catches the error and returns outcome `failed` with the error message as `reason` and a `logTail` field

#### Scenario: Bounded server-log tail
- **WHEN** the failure `logTail` is produced
- **THEN** it is the last 20 lines of `~/.pi/dashboard/server.log`, read from at most the final 8 KiB of the file, and is an empty string when the log is missing or unreadable

### Requirement: Identity-verified health discovery

The app SHALL determine whether a dashboard server is running on the configured port by issuing an HTTP GET to `/api/health` and verifying the response identity, rather than treating an open TCP port as a running dashboard.

#### Scenario: Verified dashboard responds
- **WHEN** the probe receives an HTTP 200 response from `http://<host>:<port>/api/health` whose JSON body has `ok === true` and a numeric `pid`
- **THEN** the server is reported as running
- **AND** the reported `pid` and (when present as a string) `version` are surfaced to the caller

#### Scenario: Foreign service occupies the port
- **WHEN** the probe receives an HTTP 200 response whose body does not match the dashboard shape (missing `ok === true` / numeric `pid`), or a non-OK HTTP status
- **THEN** the server is reported as not running with a port-conflict indication
- **AND** the port-conflict result short-circuits without further retries

#### Scenario: Nothing listening
- **WHEN** the probe fails with connection-refused or a timeout (abort)
- **THEN** the server is reported as not running without a port conflict

#### Scenario: Bootstrap-aware retry
- **WHEN** a caller requests additional retries and an attempt times out or returns a transient failure
- **THEN** the probe sleeps the configured retry delay and retries up to the requested attempts
- **AND** a port-conflict result stops the retry loop immediately

### Requirement: Discover-or-launch resolution

The app SHALL attach to an already-running compatible server when one is discovered on the configured port, and otherwise resolve a launch source (dev-monorepo when running from the checked-out monorepo, else the immutable bundled server) before spawning.

#### Scenario: Attach to running server
- **WHEN** `ensureServer` runs and the health probe reports a running server on the configured port
- **THEN** the app returns the server URL and attaches without spawning a new process

#### Scenario: Port occupied by another service
- **WHEN** the health probe reports a port conflict for the configured port
- **THEN** the app raises an error stating the port is in use and directs the user to change the dashboard port in `~/.pi/dashboard/config.json`

#### Scenario: Spawn from bundled source
- **WHEN** no server is running and the app is packaged with a bundled server present under the resources tree
- **THEN** the app spawns the bundled server, records the spawned PID, marks the server as started by us, and returns the local URL

#### Scenario: Spawned child stays in Electron's process group
- **WHEN** the app builds the spawn options for the dashboard-server launch
- **THEN** it sets `detach: false` so the child remains inside Electron's Job Object — the child dies when Electron exits, and on Windows no new console is allocated (no console flash)

#### Scenario: Spawn from dev monorepo
- **WHEN** no server is running, the app is not packaged, and the monorepo server CLI and bridge sources exist under the working directory
- **THEN** the app resolves the dev-monorepo source and spawns it

#### Scenario: Remote mode bypasses supervision
- **WHEN** the persisted mode is remote with a configured remote URL
- **THEN** the app returns the remote URL directly without health probing, spawning, or marking the server as started by us

### Requirement: Startup failure classification

The app SHALL distinguish server-startup failure categories so premature child exit, deadline elapse, and terminal configuration errors are routed to the correct recovery surface.

#### Scenario: Child exited prematurely
- **WHEN** the server child process exits before the readiness probe succeeds
- **THEN** the failure message identifies premature child exit and suggests a missing dependency or wrong TypeScript loader

#### Scenario: Readiness deadline elapsed
- **WHEN** the readiness probe does not succeed within the source-specific deadline (15 seconds for bundled/attach, 60 seconds for dev-monorepo)
- **THEN** the failure message identifies a non-response within the deadline and directs the user to the still-polling loading page or the Doctor button

#### Scenario: Deadline / child-exit routes to loading page
- **WHEN** a failure message begins with the deadline or premature-child-exit prefix
- **THEN** it is classified as a loading-page recovery failure rather than a terminal configuration dialog

#### Scenario: Bundled server missing
- **WHEN** no launch source resolves and no bundled server CLI is found
- **THEN** the app raises a bundled-server-missing error identifying the expected CLI path and advising reinstallation

#### Scenario: Pinned source unavailable
- **WHEN** a `DASHBOARD_PREFER_SOURCE` override pins a source that cannot be resolved
- **THEN** the app raises a pinned-source-unavailable error naming the pinned source

### Requirement: Spawned-server ownership tracking

The app SHALL track whether it started the reachable server this lifetime and SHALL only stop that server on quit when it owns it.

#### Scenario: Ownership is ours
- **WHEN** the reachable server reports `launchSourceEffective === "electron"` and its PID equals the PID this app spawned this lifetime
- **THEN** ownership is classified as electron

#### Scenario: Foreign or absent server
- **WHEN** the reachable server was not spawned by this app this lifetime, reports a non-electron effective launch source, or reports a mismatched PID
- **THEN** ownership is classified as foreign; and when the server is unreachable it is classified as none

#### Scenario: Stop only when owned on quit
- **WHEN** the app is quitting and the health-reported starter is `Electron` and the health PID matches the stored spawned PID
- **THEN** the app requests server shutdown via `/api/shutdown`; otherwise it leaves the server running

#### Scenario: Graceful shutdown suppresses crash recovery
- **WHEN** the spawned server child exits while a graceful shutdown is in progress
- **THEN** the watchdog logs a graceful exit and does not route to the crash-recovery loading page; an exit outside a graceful shutdown routes to recovery

### Requirement: Zombie server detection and adoption

The app SHALL detect a reachable server that is an orphan of a prior Electron lifetime and offer the user adoption, leaving it running, or stopping it.

#### Scenario: Zombie detection on POSIX
- **WHEN** the reachable server reports `launchSourceEffective === "electron"`, was not spawned this lifetime, has been reparented away from its boot parent, and its boot parent is no longer alive
- **THEN** the server is classified as a zombie

#### Scenario: Zombie detection on Windows
- **WHEN** the reachable server reports `launchSourceEffective === "electron"`, was not spawned this lifetime, and its boot parent is no longer alive
- **THEN** the server is classified as a zombie

#### Scenario: Adoption prompt choices
- **WHEN** a zombie is detected on the attach path
- **THEN** the app presents a modal offering Take ownership, Leave running, and Stop now, with Leave running as the default and the Esc/close (cancel) action

#### Scenario: Stop a zombie
- **WHEN** the user chooses to stop the zombie
- **THEN** the app sends SIGTERM, polls up to the timeout for the process to exit, and sends SIGKILL if still alive, reporting the server as gone

### Requirement: Lock metadata sidecar read

The app SHALL read the per-HOME dashboard lock metadata sidecar from a canonicalized home directory and return null on any missing, corrupt, or invalid content.

#### Scenario: Valid lock metadata
- **WHEN** the sidecar at `<canonical-home>/.pi/dashboard/server.lock.meta.json` parses to an object with numeric `pid` and `httpPort`, and string `identity` and `url`
- **THEN** the parsed lock metadata is returned

#### Scenario: Missing or corrupt sidecar
- **WHEN** the sidecar is absent, unreadable, non-JSON, or lacks the required fields
- **THEN** null is returned

### Requirement: Bundled bridge registration

The app SHALL register the bundled bridge extension in pi's settings, locating it in the packaged resources tree or the dev source tree, and SHALL reject an unstable AppImage-mounted path.

#### Scenario: Register from packaged resources
- **WHEN** a packaged extension directory with a `package.json` exists under the resources tree and is not a temporary AppImage mount
- **THEN** the app registers that extension path

#### Scenario: Register from dev tree
- **WHEN** running unpackaged and the extension directory exists relative to the source tree
- **THEN** the app registers that dev extension path

#### Scenario: No usable extension
- **WHEN** no bundled or dev extension is found, or the only candidate is a temporary AppImage mount
- **THEN** the app raises an error advising installation of the global package instead
