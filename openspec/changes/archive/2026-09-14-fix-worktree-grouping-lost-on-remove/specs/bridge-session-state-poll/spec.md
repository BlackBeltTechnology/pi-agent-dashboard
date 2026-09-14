## MODIFIED Requirements

### Requirement: Change-detected git forwarding (no drift)

The bridge SHALL forward a git_info_update ONLY when branch, PR number, worktree state, or working-tree status changes since the last send, comparing worktree and status via stable serialised snapshots so transitions in either direction are detected.

#### Scenario: No git change is silent
- **WHEN** a tick's branch, PR number, serialised worktree, and serialised git status all equal the last-sent values
- **THEN** no git_info_update is sent

#### Scenario: Any git change forwards the full info
- **WHEN** any of branch, PR number, worktree snapshot, or status snapshot differs from the last send
- **THEN** a git_info_update is sent carrying the branch, branch URL, PR number, PR URL, and `isGitRepo: true`
- **AND** the last-sent branch, PR, worktree, and status caches are updated to the new values

#### Scenario: Worktree present→absent and inconclusive status are encoded explicitly
- **WHEN** worktree state transitions from present to absent
- **THEN** the wire message sets `gitWorktree` to explicit `null` (distinct from omission) so the server can distinguish "not a worktree" from "no change"; how the server applies it is owned by `git-context` (already-resolved parentage is retained)
- **AND** when the git-status probe is inconclusive this tick the `gitStatus` field is omitted so the server keeps its last known status rather than clearing to a false all-clean

#### Scenario: Reconnect cache reset re-sends non-persisted git fields
- **WHEN** the reconnect-cache reset runs (e.g. after a server-restart-driven reconnect)
- **THEN** the last branch, PR, worktree, and status caches are cleared so the next tick re-sends them
