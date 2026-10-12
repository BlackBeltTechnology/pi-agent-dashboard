## MODIFIED Requirements

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
