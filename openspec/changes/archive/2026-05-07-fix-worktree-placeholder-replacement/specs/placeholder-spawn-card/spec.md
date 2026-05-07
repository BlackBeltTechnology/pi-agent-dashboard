## MODIFIED Requirements

### Requirement: Placeholder replaced on session added
When a `session_added` message arrives, the system SHALL check if the session's `cwd` or `groupCwd` matches any spawning group cwd. If a match is found, the system SHALL remove the placeholder card for that group. The real session card SHALL appear in the placeholder's visual position (top of the group). The server SHALL ensure the new session is placed at the front of the session order for the group's cwd (using `groupCwd` if set) so the client renders it at the top.

#### Scenario: Session added replaces placeholder
- **WHEN** a `session_added` message arrives with `session.cwd` matching a spawning group's cwd
- **THEN** the placeholder card for that group SHALL be removed
- **AND** the real session card SHALL render at the top of the group's session list

#### Scenario: Worktree session replaces placeholder via groupCwd
- **WHEN** a `session_added` arrives for a worktree-spawned session where `session.cwd` is a worktree path and `session.groupCwd` matches the spawning group's cwd
- **THEN** the placeholder card for the spawning group SHALL be removed
- **AND** the real session card SHALL render at the top of the spawning group's session list (where the placeholder was)

#### Scenario: Sequential multi-spawn places most recent at top
- **WHEN** the user spawns three sessions for the same group in sequence: first A, then B, then C (each completing before the next starts)
- **THEN** each session card SHALL replace its corresponding placeholder in-place
- **AND** after all three register, the final rendered order SHALL be C at top, then B, then A (most recently spawned at top)
