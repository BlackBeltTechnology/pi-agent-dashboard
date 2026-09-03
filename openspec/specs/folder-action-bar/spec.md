# folder-action-bar Specification

## Purpose

Define the folder-group action bar and elevated spawn buttons rendered in the sidebar.
## Requirements
### Requirement: +Worktree button opens worktree dialog
The `+ New Worktree` action SHALL be presented as a full-width line button in the elevated spawn-button stack (see "Elevated folder spawn buttons"), not as a pill in the action bar. Clicking it SHALL open `WorktreeSpawnDialog` scoped to the folder's cwd. The button SHALL be hidden (not disabled) unless the folder is detected as a git repository AND the global preference `gitWorktreeEnabled` is `true` AND a spawn handler is wired.

The flag is a UI preference only. The underlying `POST /api/git/worktree` endpoint is unaffected; access control remains the server-side network guard.

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

### Requirement: +Session button
The `+ New Session` action SHALL be presented as a full-width line button in the elevated spawn-button stack (see "Elevated folder spawn buttons"), not as a pill in the action bar. It SHALL spawn a new pi session in the folder's cwd and SHALL be disabled while a session is being spawned in that folder.

#### Scenario: Spawn session
- **WHEN** the user clicks `+ New Session`
- **THEN** a new pi session SHALL be spawned in the folder's cwd
- **THEN** the button SHALL be disabled until the spawn completes

### Requirement: Elevated folder spawn buttons
Each folder group SHALL render an elevated spawn-button stack in the always-visible folder header content column, positioned below the action bar and below the plugin / OpenSpec folder sections (the OpenSpec section renders above the spawn-button stack). The stack SHALL contain a full-width `+ New Session` button (always rendered) and, when worktree gating holds, a full-width `+ New Worktree` button stacked directly below it. The stack SHALL remain visible regardless of the folder's collapse state and regardless of session count (including 0 sessions).

#### Scenario: Buttons visible while collapsed
- **WHEN** a folder group is collapsed
- **THEN** the `+ New Session` button SHALL still be visible in the header

#### Scenario: Buttons visible with zero sessions
- **WHEN** a folder group has 0 sessions (e.g. a pinned empty folder)
- **THEN** the `+ New Session` button SHALL render

#### Scenario: Worktree button stacked below session button
- **WHEN** worktree gating holds (`isGitRepo` AND `gitWorktreeEnabled` AND handler wired)
- **THEN** the `+ New Worktree` button SHALL render as a full-width button directly below `+ New Session`

### Requirement: Spawn auto-expands collapsed folder
When a folder is collapsed and the user clicks `+ New Session` or `+ New Worktree`, the folder SHALL first expand and then perform the spawn action, so the resulting placeholder card and new session card are visible. When the folder is already expanded, the action SHALL run without changing collapse state.

#### Scenario: Spawn while collapsed expands then spawns
- **WHEN** a folder is collapsed AND the user clicks `+ New Session`
- **THEN** the folder SHALL expand
- **THEN** a new pi session SHALL be spawned in the folder's cwd

#### Scenario: Spawn while expanded does not toggle collapse
- **WHEN** a folder is already expanded AND the user clicks `+ New Session`
- **THEN** the folder SHALL remain expanded
- **THEN** a new pi session SHALL be spawned in the folder's cwd

