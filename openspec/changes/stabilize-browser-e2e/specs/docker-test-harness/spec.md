## ADDED Requirements

### Requirement: A second harness on the same daemon is admitted only within the daemon's memory

Before bringing a stack up, the harness SHALL count the other `pi-dash-test-*` compose projects with at least one running container on the same Docker daemon. It SHALL compare `(others + 1) × MEM_LIMIT` (the declared per-harness cap, default 4 GiB) against the daemon's total memory. When the product exceeds the total, the harness SHALL refuse to start and print the other project names, the per-harness cap, the daemon total, and the override variable `PI_HARNESS_ALLOW_OVERSUBSCRIBE=1`. When it fits but at least one other harness is running, the harness SHALL print one warning that red results under contention may not be attributable. The check SHALL NOT alter the port or project derivation and SHALL NOT touch the other projects.

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
- **WHEN** no other `pi-dash-test-*` project is running
- **THEN** `test-up.sh` output SHALL be unchanged

### Requirement: Harness container lifecycle events are capturable for audit

The repository SHALL provide a helper that records Docker container lifecycle events (`create`, `start`, `die`, `destroy`, `kill`) for containers whose compose project matches `pi-dash-test-*`, with a timestamp and the acting project, to a file the caller names, until interrupted. The E2E README SHALL document running it alongside a long suite so that a mid-run cross-project destruction yields an event record rather than a reconstructed timeline.

#### Scenario: Events for two harnesses are attributed
- **WHEN** the helper runs while worktree A tears down and worktree B stays up
- **THEN** the file SHALL contain A's `destroy` with A's project name and no `destroy` for B's container

#### Scenario: Helper is inert on a daemon with no harness
- **WHEN** no harness container exists
- **THEN** the helper SHALL run until interrupted and write no event lines
