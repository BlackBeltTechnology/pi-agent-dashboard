## MODIFIED Requirements

### Requirement: Collision-free isolation from the host dashboard

A test instance launched via the harness SHALL NOT collide with a dashboard already running on the host across any of the four collision vectors: the single-dashboard-per-home lock, mDNS discovery, network ports, and the `~/.pi` state directory. The harness SHALL ALSO NOT collide with any other harness instance running on the same host (e.g. a second instance launched from a parallel git worktree).

#### Scenario: Second instance starts despite the host home-lock

- **WHEN** a dashboard is already running on the host (holding `~/.pi/dashboard` lock) and the harness is spun up
- **THEN** the container starts cleanly with its own isolated `$HOME` (`/home/pi`)
- **AND** does not touch, read, or contend for the host's `~/.pi/dashboard` lock or pidfile

#### Scenario: Test instance never advertises or browses mDNS

- **WHEN** the harness starts with `PI_DASHBOARD_NO_MDNS=1`
- **THEN** the server logs that mDNS advertising is disabled
- **AND** no `_pi-dashboard._tcp` record for the test instance appears on the host LAN

#### Scenario: Ports do not clash with the host dashboard

- **WHEN** the host dashboard owns 8000 and 9999 and the harness is spun up
- **THEN** the test instance is reachable on its chosen high host ports (default window 18000–18999 HTTP, 19000–19999 gateway)
- **AND** binding succeeds without `EADDRINUSE`

#### Scenario: Two parallel worktrees run simultaneously without collision

- **WHEN** `test-up.sh` is run from worktree A and, while A is still up, from worktree B (different `HOST_CWD`)
- **THEN** each instance binds a distinct, free host port pair derived from its own `HOST_CWD`
- **AND** each runs under a distinct compose project name (`pi-dash-test-<hash>`) so neither recreates nor attaches the other's containers
- **AND** both dashboards are reachable simultaneously on their respective URLs

#### Scenario: Same worktree gets stable ports across restarts

- **WHEN** `test-up.sh` is run, torn down, and run again from the same worktree
- **THEN** the instance binds the same host port pair on the second run (absent an external process having taken them)

#### Scenario: Teardown targets only the calling worktree's instance

- **WHEN** two worktrees each have a live instance and `test-down.sh` is run from worktree A
- **THEN** only worktree A's stack (its `-p <project>`) is brought down and its state file removed
- **AND** worktree B's instance remains running and reachable

#### Scenario: State is ephemeral and never pollutes host `~/.pi`

- **WHEN** the harness runs and is torn down with `test-down.sh`
- **THEN** all session, auth, and config state written during the run is discarded with the tmpfs volume
- **AND** the host's `~/.pi` directory is byte-identical before and after the run
