## ADDED Requirements

### Requirement: Local full-stack alignment converges the pi runtime consumers
The supported runtime selection path SHALL allow the local dashboard service, spawned sessions, and imported pi runtime to converge on one current install for both runtime consumers. Convergence SHALL be verifiable in `/api/health` through the per-consumer versions and `consumerDiverged`.

#### Scenario: Mixed local runtime versions are aligned
- **WHEN** local health reports the two runtime consumers on different pi versions
- **AND** the operator selects one supported current install for both consumers through `POST /api/pi/runtime` and reloads active sessions
- **THEN** subsequent health SHALL report the same active pi version for both the spawn and module consumers
- **AND** `consumerDiverged` SHALL be false
- **AND** `installSetDiverged` MAY remain true while a non-selected install of another version stays discoverable on disk (e.g. an unrelated worktree's `node_modules`), because clearing it would require editing an unrelated worktree or an out-of-range dependency bump, both outside this change's mutation boundary

#### Scenario: Conflicting bridge checkout paths need coordinated global cleanup
- **WHEN** plugin health reports the dashboard bridge from more than one checkout path
- **AND** the conflicting entries are absolute bridge paths in global settings that belong to other active checkouts
- **THEN** removing the conflict SHALL be performed only as a coordinated global-settings mutation gated by the fresh-Pi startup check, never by editing the unrelated worktrees
- **AND** when other active sessions depend on those entries, the conflict MAY be recorded as a residual instead of being cleared unilaterally
