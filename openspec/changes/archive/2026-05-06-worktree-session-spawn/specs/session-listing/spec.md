## ADDED Requirements

### Requirement: Session card displays worktree indicator
The `SessionCard` component SHALL render a worktree indicator when the session's `cwd` resides inside a git worktree. Detection SHALL walk up the directory tree from `cwd` to find a `.git` file (worktrees use `.git` as a file, not a directory). The indicator SHALL display the branch name from git metadata and a worktree icon.

#### Scenario: Worktree indicator visible
- **WHEN** a session has `cwd` inside a git worktree (detected server-side by walking up directories to find a `.git` file)
- **THEN** the session card SHALL display a worktree icon and the branch name next to the session cwd path

#### Scenario: Worktree indicator hidden for main worktree
- **WHEN** a session's `cwd` is the repository's main working tree
- **THEN** the session card SHALL NOT display a worktree indicator

#### Scenario: Worktree branch name sourced from git
- **WHEN** the session is inside a worktree checked out on branch `feature-auth`
- **THEN** the indicator SHALL show "feature-auth" as the branch name

### Requirement: DashboardSession includes worktree metadata
The `DashboardSession` type SHALL include an optional `worktree` field of type `{ branch: string; path: string } | undefined`. The server SHALL populate this field when a session's `cwd` is inside a git worktree.

#### Scenario: Worktree metadata populated on register
- **WHEN** a bridge registers a session with `cwd` inside a git worktree
- **THEN** the server SHALL detect the worktree by walking up from `cwd` to find a `.git` file (not directory)
- **AND** populate `session.worktree = { branch, path }` where path is the worktree root
- **AND** the `session_updated` broadcast SHALL include the `worktree` field

#### Scenario: Non-worktree session has no worktree metadata
- **WHEN** a session's `cwd` is in the main working tree
- **THEN** `session.worktree` SHALL be `undefined`

#### Scenario: Worktree metadata included in sessions_snapshot
- **WHEN** the server sends a `sessions_snapshot` to a browser
- **THEN** worktree sessions SHALL include their `worktree` field in the payload
