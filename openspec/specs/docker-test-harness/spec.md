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

### Requirement: The harness SHALL survive a full suite run within its memory cap

The Docker test harness SHALL complete an entire browser-E2E suite run without exhausting its container memory cap. The cap is declared by `docker/compose.yml` (`MEM_LIMIT`, default 4 GiB) and inherited by the test overlay; the harness SHALL stay within it by bounding the number of concurrently resident dashboard-spawned pi sessions, NOT by raising the cap.

The dominant consumer SHALL be treated as spawned pi session processes (measured at 150–280 MB RSS each against a ~630 MB dashboard server). The RAM-backed `pi-state` tmpfs SHALL NOT be assumed to be the consumer: it was measured at 19 MB of its 2 GB during an exhausted run.

#### Scenario: A full run finishes with the container healthy

- **WHEN** the complete browser-E2E suite runs against one harness container
- **THEN** the run SHALL reach its final spec
- **AND** the container SHALL still report healthy at the end
- **AND** the dashboard daemon SHALL NOT have been restarted except by the spec that deliberately calls `POST /api/restart`

#### Scenario: Memory does not climb across the run

- **WHEN** container memory is sampled out-of-band (from the host, against the container's own cgroup) after an early chunk of specs and again after a later chunk
- **THEN** `memory.current` after the later chunk SHALL be no greater than the early-chunk sample plus 10 %
- **AND** the count of resident pi session processes SHALL NOT grow with the number of specs executed

#### Scenario: Resident process count tracks the reported session count

- **WHEN** the resident pi process count and the dashboard's live-session count are sampled at the same point in a run
- **THEN** any persistent divergence SHALL be recorded, because a process invisible to the session list is invisible to the suite's own leak guard

#### Scenario: The memory cap is unchanged by this guarantee

- **WHEN** the harness configuration is inspected after this change
- **THEN** the declared memory cap SHALL be unchanged
- **AND** the healthcheck cadence and the PID-1 supervisor restart-grace behaviour SHALL be unchanged

### Requirement: A second harness on the same daemon is admitted only within the daemon's memory

Before bringing a stack up, the harness SHALL count the other `pi-dash-test-*` compose projects with at least one running container on the same Docker daemon. It SHALL compare `(others + 1) × MEM_LIMIT` (the declared per-harness cap, default 4 GiB) against the daemon's total memory — including when `others` is zero, so a lone harness whose cap alone does not fit is refused too. When the product exceeds the total, the harness SHALL refuse to start and print the per-harness cap, the daemon total, the override variable `PI_HARNESS_ALLOW_OVERSUBSCRIBE=1`, and — only when at least one other harness is running — the other project names; the refusal headline SHALL NOT describe the condition as co-resident when no other harness is running. When it fits but at least one other harness is running, the harness SHALL print one warning that red results under contention may not be attributable. When the daemon's memory or the cap cannot be read, a lone harness SHALL proceed silently and a co-resident harness SHALL proceed with one warning. The check SHALL NOT alter the port or project derivation and SHALL NOT touch the other projects.

#### Scenario: Two 4 GiB harnesses on an 8 GB daemon are refused
- **GIVEN** worktree A's harness is running and the daemon reports 8 GiB total
- **WHEN** worktree B runs `test-up.sh` with the default `MEM_LIMIT`
- **THEN** it SHALL exit non-zero before `compose up`, naming A's project and the `2 × 4 GiB > 8 GiB` arithmetic
- **AND** A's containers SHALL be untouched

#### Scenario: Override admits the oversubscribed harness
- **WHEN** worktree B sets `PI_HARNESS_ALLOW_OVERSUBSCRIBE=1` in the same situation
- **THEN** the harness SHALL start and print the contention warning

#### Scenario: A second harness that fits is admitted with a warning
- **GIVEN** the daemon reports 16 GiB and A is running
- **WHEN** B runs `test-up.sh`
- **THEN** it SHALL start and print exactly one contention warning

#### Scenario: A lone harness prints nothing extra
- **GIVEN** no other `pi-dash-test-*` project is running
- **WHEN** `test-up.sh` runs with a `MEM_LIMIT` below the daemon total
- **THEN** `test-up.sh` output SHALL be unchanged

#### Scenario: A lone harness whose cap exceeds the daemon is refused
- **GIVEN** no other `pi-dash-test-*` project is running and the daemon reports 8 GiB total
- **WHEN** `test-up.sh` runs with `MEM_LIMIT=8g`
- **THEN** it SHALL exit non-zero before `compose up`, printing the `1 × 8 GiB >= 8 GiB` arithmetic and the override variable
- **AND** the refusal headline SHALL NOT say "co-resident"

#### Scenario: Override admits a lone oversized harness
- **GIVEN** no other `pi-dash-test-*` project is running and `MEM_LIMIT` does not fit the daemon
- **WHEN** `PI_HARNESS_ALLOW_OVERSUBSCRIBE=1` is set
- **THEN** the harness SHALL start and print exactly one oversubscription warning

#### Scenario: A lone harness with unreadable memory proceeds silently
- **GIVEN** no other `pi-dash-test-*` project is running
- **WHEN** the daemon's total memory cannot be read
- **THEN** `test-up.sh` SHALL proceed with output unchanged

### Requirement: Harness container lifecycle events are capturable for audit

The repository SHALL provide a helper that records Docker container lifecycle events (`create`, `start`, `die`, `destroy`, `kill`) for containers whose compose project matches `pi-dash-test-*`, with a timestamp and the acting project, to a file the caller names, until interrupted. The E2E README SHALL document running it alongside a long suite so that a mid-run cross-project destruction yields an event record rather than a reconstructed timeline.

Capture SHALL NOT depend on a human having started it before the incident. The harness boot script (`docker/test-up.sh`) SHALL start a recorder scoped to the compose project it brings up — after deriving the project and BEFORE `compose up`, so the boot's own `create`/`start` lines are captured — writing to a per-project events file OUTSIDE the worktree (`${TMPDIR:-/tmp}/pi-dash-test/<project>.events.log`, appended across boots of the same project). Every recorded event line SHALL carry the container ID. When the recorder first observes its project's container it SHALL append a boot line naming the project and that container ID. `test-up.sh` SHALL record the recorder's PID and the events-file path in the workspace's harness state file and, once a detached `compose up` returns, the container ID (`containerId`); when `compose up` fails, `test-up.sh` SHALL stop the recorder it started. The events file therefore survives worktree removal (ship-it removes the worktree after teardown); its retention is the OS temporary-directory policy. Booting is idempotent for the recorder: when `docker/test-up.sh` runs against an already-running project whose state file names a live recorder PID, it SHALL NOT start a second recorder and SHALL carry that PID and path into the rewritten state file, together with the container ID current after `compose up` (a new boot line is appended when that ID differs from the recorded one). The harness teardown script (`docker/test-down.sh`) SHALL append a teardown marker line carrying the container ID — from the state file, or resolved from the running project when the state file has none (attached boot) — before it removes the harness, SHALL wait (bounded, at most 10 seconds) for that container's `destroy` line to appear after the marker, SHALL then stop the recorder, and SHALL print the events-file path. Every caller of those scripts — Playwright managed mode, the ship-it orchestrator, a developer — therefore captures by default. The recorder SHALL be best-effort: when the Docker event stream cannot be opened, or the events directory cannot be created or written, the boot SHALL proceed unchanged, with exactly one warning on stderr, no failure, and no recorder PID in the state file. When `docker/test-down.sh` finds the recorded recorder PID dead or absent, it SHALL print one warning on stderr, SHALL still append the teardown marker when the events file is writable, SHALL skip the destroy wait, SHALL tear the harness down, and SHALL exit successfully. In project-scoped mode the recorder SHALL also exit on its own, under this rule: it is ARMED only after it has observed its project's container (a `create`/`start` event for the project, or the container present on a poll); while unarmed it SHALL NOT exit for the container's absence, so a recorder started before `compose up` never exits early; once armed it SHALL exit on the first poll (every 30 seconds) that finds no container for its project. As a leak guard independent of Docker state, a project-scoped recorder SHALL exit after a bounded maximum lifetime (12 hours). A recorder therefore outlives its harness by at most one poll interval once it has seen the container, and by at most the maximum lifetime in any case. The helper's unscoped manual mode (no project) keeps running until interrupted. Capture is a local-diagnosis aid; CI legs are not required to upload the events file.

The repository SHALL document, alongside the harness lifecycle commands, that container removal filtered by the shared `pi-dash-test` name prefix and daemon-wide container pruning both cross compose-project boundaries and can destroy another worktree's harness mid-run, and that the supported teardown is the repository's own per-worktree teardown script.

#### Scenario: Events for two harnesses are attributed
- **WHEN** the helper runs while worktree A tears down and worktree B stays up
- **THEN** the file SHALL contain A's `destroy` with A's project name and no `destroy` for B's container

#### Scenario: Helper is inert on a daemon with no harness
- **WHEN** the helper runs in its unscoped manual mode and no harness container exists
- **THEN** the helper SHALL run until interrupted and write no event lines

#### Scenario: A recorder started before its container does not exit early
- **GIVEN** a project-scoped recorder started by `docker/test-up.sh` before `compose up`
- **WHEN** a poll runs before the project's container exists
- **THEN** the recorder SHALL keep running, unarmed
- **AND** it SHALL record the container's `create`/`start` lines once `compose up` runs

#### Scenario: Booting a harness records events without being asked
- **WHEN** a harness is booted with `docker/test-up.sh` (by Playwright managed mode, by ship-it, or by hand) and specs run against it
- **THEN** the lifecycle events for that harness's compose project SHALL be recorded to its per-project events file outside the worktree for the life of the harness
- **AND** the file SHALL remain available after teardown and after the worktree is removed, including when the run ended red

#### Scenario: Own teardown is distinguishable from a foreign destroy
- **WHEN** `docker/test-down.sh` tears the harness down
- **THEN** the events file SHALL contain a teardown marker line carrying that harness's container ID, preceding the `destroy` event for the same container ID
- **AND** a teardown marker carrying a different container ID (an earlier boot of the same project) SHALL NOT count as this harness's teardown
- **AND** the recorder SHALL NOT be stopped before that `destroy` line is written, unless 10 seconds pass first

#### Scenario: Re-running test-up on a live harness keeps one recorder
- **GIVEN** a running harness whose state file names a live recorder
- **WHEN** `docker/test-up.sh` is run again for the same worktree
- **THEN** exactly one recorder for that project SHALL be running
- **AND** the rewritten state file SHALL still name its PID, so `docker/test-down.sh` stops it

#### Scenario: Recorder failure does not fail the boot
- **GIVEN** the Docker event stream cannot be opened
- **WHEN** `docker/test-up.sh` boots the harness
- **THEN** the harness SHALL boot and specs SHALL be able to run
- **AND** exactly one stderr warning SHALL state that lifecycle capture is unavailable

#### Scenario: An unwritable events directory does not fail the boot
- **GIVEN** the per-project events directory cannot be created or written
- **WHEN** `docker/test-up.sh` boots the harness
- **THEN** the harness SHALL boot
- **AND** exactly one stderr warning SHALL state that lifecycle capture is unavailable
- **AND** the state file SHALL name no recorder PID

#### Scenario: A dead recorder does not fail teardown
- **GIVEN** a harness whose state file names a recorder PID that is no longer running, or names none
- **WHEN** `docker/test-down.sh` tears the harness down
- **THEN** it SHALL print one warning on stderr
- **AND** it SHALL append the teardown marker when the events file is writable
- **AND** it SHALL NOT wait for a `destroy` line
- **AND** it SHALL remove the harness and exit successfully

#### Scenario: Teardown stops the recorder
- **WHEN** the harness is torn down by `docker/test-down.sh`
- **THEN** its recorder SHALL no longer be running when the script exits

#### Scenario: An orphaned recorder exits on its own
- **GIVEN** a project-scoped recorder that has observed its project's container
- **WHEN** the harness container disappears without `docker/test-down.sh` running (interrupted run, foreign destroy)
- **THEN** the recorder SHALL exit within one poll interval

#### Scenario: A recorder whose container never appears is bounded
- **WHEN** a project-scoped recorder never observes its project's container and `test-up.sh` did not stop it
- **THEN** the recorder SHALL exit once its maximum lifetime elapses
