## MODIFIED Requirements

### Requirement: +Worktree button opens worktree dialog
The `+ New Worktree` action SHALL be presented as a full-width line button in the elevated spawn-button stack (see "Elevated folder spawn buttons"), not as a pill in the action bar. Clicking it SHALL open `WorktreeSpawnDialog` scoped to the folder's cwd. The button SHALL be hidden (not disabled) unless the folder is detected as a git repository AND the global preference `gitWorktreeEnabled` is `true` AND a spawn handler is wired.

The flag is a UI preference only. The underlying `POST /api/git/worktree` endpoint is unaffected by the flag; access control is the server-side network guard plus cwd admission (see `core-cwd-admission`).

#### Scenario: Click +Worktree with flag enabled
- **WHEN** `gitWorktreeEnabled` is `true` AND the folder is a git repo AND the user clicks `+ New Worktree`
- **THEN** `WorktreeSpawnDialog` SHALL open with `cwd` set to the folder's cwd

#### Scenario: Worktree preference disabled hides button
- **WHEN** `gitWorktreeEnabled` is `false`
- **THEN** the `+ New Worktree` button SHALL NOT render on any folder, regardless of git status

#### Scenario: Non-git folder hides +Worktree
- **WHEN** a folder group is rendered for a directory that is not a git repository
- **THEN** the `+ New Worktree` button SHALL NOT appear
- **THEN** the `+ New Session` button SHALL still render
