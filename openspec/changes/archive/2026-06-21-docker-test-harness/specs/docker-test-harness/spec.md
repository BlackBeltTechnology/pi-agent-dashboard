## ADDED Requirements

### Requirement: Collision-free isolation from the host dashboard

A test instance launched via the harness SHALL NOT collide with a dashboard already running on the host across any of the four collision vectors: the single-dashboard-per-home lock, mDNS discovery, network ports, and the `~/.pi` state directory.

#### Scenario: Second instance starts despite the host home-lock

- **WHEN** a dashboard is already running on the host (holding `~/.pi/dashboard` lock) and the harness is spun up
- **THEN** the container starts cleanly with its own isolated `$HOME` (`/home/pi`)
- **AND** does not touch, read, or contend for the host's `~/.pi/dashboard` lock or pidfile

#### Scenario: Test instance never advertises or browses mDNS

- **WHEN** the harness starts with `PI_DASHBOARD_NO_MDNS=1`
- **THEN** the server logs that mDNS advertising is disabled
- **AND** no `_pi-dashboard._tcp` record for the test instance appears on the host LAN
- **AND** the host dashboard's peer list gains no entry for the test instance

#### Scenario: Ports do not clash with the host dashboard

- **WHEN** the host dashboard owns 8000 and 9999 and the harness is spun up
- **THEN** the test instance is reachable on host ports 18000 (HTTP) and 18999 (pi gateway)
- **AND** binding succeeds without `EADDRINUSE`

#### Scenario: State is ephemeral and never pollutes host `~/.pi`

- **WHEN** the harness runs and is torn down with `test-down.sh`
- **THEN** all session, auth, and config state written during the run is discarded with the tmpfs volume
- **AND** the host's `~/.pi` directory is byte-identical before and after the run

### Requirement: Path-identical workspace mounting onto a throwaway overlay

The harness SHALL mount the host current working directory into the container at the identical absolute path, writable, while guaranteeing the host directory is never modified.

#### Scenario: Container paths match host paths

- **WHEN** `test-up.sh` is run from host directory `/Users/robson/Project/foo`
- **THEN** the container exposes that directory at the identical path `/Users/robson/Project/foo`
- **AND** the dashboard's working directory, session CWDs, and VCS roots for that workspace read identically to the host paths in logs and UI

#### Scenario: Writes do not touch host files

- **WHEN** an agent or process inside the container writes to or deletes files under the mounted path
- **THEN** the writes land in the tmpfs overlay upper layer
- **AND** the host directory's contents are byte-identical before the run and after teardown

#### Scenario: Copy-mode fallback when SYS_ADMIN is unavailable

- **WHEN** the harness runs with `TEST_COPY_MODE=1`
- **THEN** the overlay mount is skipped and the host directory is copied to a tmpfs at the identical path
- **AND** the container requires no `CAP_SYS_ADMIN`
- **AND** host files remain untouched

### Requirement: Fail-fast smoke check before ready

The harness SHALL run a minimal health probe at startup and fail fast if the instance is not serving, before a human is directed to a browser.

#### Scenario: Healthy instance prints its URL

- **WHEN** the image is built correctly and the instance starts
- **THEN** the entrypoint confirms HTTP `GET /api/health` returns 200 and one WebSocket connect succeeds
- **AND** `test-up.sh` prints `http://localhost:18000`

#### Scenario: Broken build fails before the browser step

- **WHEN** the dashboard fails to serve (broken image/build)
- **THEN** the smoke check exits non-zero
- **AND** no ready URL is printed

### Requirement: Baked VCS fixtures for panel testing

The image SHALL bake a sample git repository and a sample jj repository so VCS panels can be exercised without mounting any host directory.

#### Scenario: Fixtures available as workspaces

- **WHEN** the harness starts without a path-parity mount
- **THEN** `/fixtures/sample-git` and `/fixtures/sample-jj` are present and pinnable as workspaces
- **AND** each is a valid initialized repository in its respective VCS
