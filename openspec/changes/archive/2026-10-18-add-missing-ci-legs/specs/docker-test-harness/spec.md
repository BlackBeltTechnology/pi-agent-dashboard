## MODIFIED Requirements

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
