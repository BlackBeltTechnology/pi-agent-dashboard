## Purpose

[Spec purpose]
## Requirements
### Requirement: Placeholder card shown during session spawn
When the user clicks "New" to spawn a session in a workspace group, the system SHALL immediately render a placeholder skeleton card at the top of that group's session list. The placeholder SHALL display a pulse/loading animation to indicate a spawn is in progress.

#### Scenario: User clicks New in a group
- **WHEN** user clicks the "New" button in a workspace group header
- **THEN** a placeholder card with pulse animation SHALL appear at the top of that group's session list immediately, before any server response

#### Scenario: Placeholder appears above existing sessions
- **WHEN** a placeholder card is rendered for a group
- **THEN** it SHALL appear before all real session cards in that group

### Requirement: New button disabled during spawn
While a spawn is in progress for a workspace group, the "New" button for that specific group SHALL be disabled. Other groups' "New" buttons SHALL remain enabled and functional.

#### Scenario: New button disabled for spawning group
- **WHEN** a spawn is in progress for a workspace group
- **THEN** the "New" button for that group SHALL be disabled (not clickable)
- **AND** "New" buttons for other groups SHALL remain enabled

#### Scenario: New button re-enabled after spawn completes
- **WHEN** the spawn completes (session added or failure)
- **THEN** the "New" button for that group SHALL be re-enabled

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

### Requirement: Placeholder removed on spawn failure
When a `spawn_result` message arrives with `success: false`, the system SHALL remove the placeholder card for the matching cwd and display an error toast.

#### Scenario: Spawn fails
- **WHEN** a `spawn_result` message arrives with `success: false`
- **THEN** the placeholder card for that cwd SHALL be removed
- **AND** an error toast SHALL be displayed

### Requirement: Safety timeout for stuck placeholders
If neither `session_added` nor a failed `spawn_result` clears the placeholder within 30 seconds, the system SHALL automatically remove the placeholder to prevent stuck UI states.

#### Scenario: Timeout clears placeholder
- **WHEN** 30 seconds elapse after spawn was initiated
- **AND** the placeholder has not been cleared by `session_added` or `spawn_result`
- **THEN** the placeholder SHALL be automatically removed
- **AND** the "New" button SHALL be re-enabled

### Requirement: Placeholder card visual style
The placeholder skeleton card SHALL match the redesigned SessionCard visual style: `rounded-xl`, same padding (`px-4 py-3` on mobile, `px-3 py-2.5` on desktop), border matching `border-[var(--border-subtle)]`, and the same `bg-[var(--bg-tertiary)]`. The pulse animation SHALL continue to indicate loading.

#### Scenario: Placeholder matches card style on mobile
- **WHEN** a placeholder card renders on viewport < 768px
- **THEN** it SHALL have the same border-radius, padding, and background as the redesigned mobile SessionCard

#### Scenario: Placeholder matches card style on desktop
- **WHEN** a placeholder card renders on viewport >= 768px
- **THEN** it SHALL have the same border-radius, padding, and background as the redesigned desktop SessionCard

