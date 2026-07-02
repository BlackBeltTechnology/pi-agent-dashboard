# docker-test-harness Specification

## Purpose
Disposable, fully-isolated containerized pi-dashboard for manual browser QA and clean-install verification. Guarantees no collision with a host dashboard across home-lock, mDNS, ports, and `~/.pi` state; provides path-identical workspace mounting onto a throwaway overlay, a baked git fixture, and a fail-fast smoke check.
## Requirements
### Requirement: Collision-free isolation from the host dashboard

A test instance launched via the harness SHALL NOT collide with a dashboard already running on the host across any of the four collision vectors: the single-dashboard-per-home lock, mDNS discovery, network ports, and the `~/.pi` state directory. The harness SHALL ALSO NOT collide with any other harness instance running on the same host (e.g. a second instance launched from a parallel git worktree), across BOTH the host-port vector AND the container-image vector, and SHALL recover from a transient port-bind race.

#### Scenario: Two parallel worktrees run simultaneously without collision

- **WHEN** the harness is run from worktree A and, while A is still up, from worktree B (different `HOST_CWD`)
- **THEN** each instance binds a distinct, free host port pair derived from its own `HOST_CWD`
- **AND** each runs under a distinct compose project name (`pi-dash-test-<hash>`) so neither recreates nor attaches the other's containers
- **AND** each builds/uses a distinct image tag (`pi-dash-test-<hash>`) so neither reuses nor clobbers the other's image
- **AND** both dashboards are reachable simultaneously on their respective URLs

#### Scenario: Image tag is scoped per worktree

- **WHEN** worktree A and worktree B each launch the harness
- **THEN** A's container runs the image built from A's build context and B's from B's
- **AND** a run from one worktree never silently reuses an image built from a different worktree's code

#### Scenario: Transient port-bind race is recovered in-window

- **WHEN** `docker compose up` fails to publish a host port because another process grabbed it between probe and bind (`port is already allocated`)
- **THEN** the harness re-derives the next free port within the same disjoint window and retries, up to a bounded number of attempts
- **AND** a non-port failure is propagated immediately without retry

#### Scenario: Teardown removes only the calling worktree's image and stack

- **WHEN** two worktrees each have a live instance and teardown is run from worktree A
- **THEN** only worktree A's stack (its `-p <project>`) is brought down
- **AND** worktree A's per-worktree image (`pi-dash-test-<hash>`) is removed best-effort
- **AND** worktree B's instance and image remain intact

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

The image SHALL bake a sample git repository so VCS panels can be exercised without mounting any host directory.

#### Scenario: Fixtures available as workspaces

- **WHEN** the harness starts without a path-parity mount
- **THEN** `/fixtures/sample-git` is present and pinnable as a workspace
- **AND** it is a valid initialized git repository

