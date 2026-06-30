## MODIFIED Requirements

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
