## MODIFIED Requirements

### Requirement: Auto-place new sessions at the beginning
When a new session registers, the server SHALL prepend its ID to the front of the order array for its cwd. If the session has `groupCwd` set (e.g., worktree sessions), the server SHALL prepend to the `groupCwd` order array instead.

#### Scenario: New session prepended
- **WHEN** a session registers with cwd `/project` and the current order is `["s1", "s2"]`
- **THEN** the order SHALL become `["s3", "s1", "s2"]`

#### Scenario: Worktree session prepended to groupCwd order
- **WHEN** a session registers with cwd `/repo/.pi/worktrees/feature-x/` and `groupCwd: "/repo"`
- **THEN** the server SHALL prepend the session ID to the order for `/repo` (not the worktree path)

#### Scenario: First session in a cwd
- **WHEN** a session registers with a cwd that has no existing order
- **THEN** the order SHALL be `["s1"]`

### Requirement: Broadcast order changes
The server SHALL broadcast a `sessions_reordered` message to all connected browsers whenever the order for a cwd changes (insert, reorder, or removal). For sessions with `groupCwd` set, the broadcast SHALL use `cwd: <groupCwd>`.

#### Scenario: Order broadcast on new worktree session
- **WHEN** a worktree session registers with `groupCwd: "/repo"` and is prepended to `/repo` order
- **THEN** the server SHALL broadcast `sessions_reordered { cwd: "/repo", sessionIds: [...] }`

#### Scenario: Order broadcast on new session
- **WHEN** a new session is prepended to a cwd's order
- **THEN** the server SHALL broadcast `sessions_reordered` with the updated order

#### Scenario: Order broadcast on drag-and-drop
- **WHEN** the browser sends `reorder_sessions`
- **THEN** the server SHALL broadcast `sessions_reordered` to all connected browsers
