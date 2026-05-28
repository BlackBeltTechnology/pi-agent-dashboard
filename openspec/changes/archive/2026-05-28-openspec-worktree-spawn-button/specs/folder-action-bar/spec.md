## MODIFIED Requirements

### Requirement: +Worktree button opens worktree dialog
The `+Worktree` button in the folder action bar SHALL open the worktree spawn dialog (`WorktreeSpawnDialog`) scoped to the folder's cwd. Visibility of the button SHALL additionally be gated on the new global preference `gitWorktreeEnabled` (default `true`) — when the flag is `false`, the button SHALL NOT render even on git folders.

The flag is a UI preference only. The underlying `POST /api/git/worktree` endpoint is unaffected; access control remains the server-side network guard.

#### Scenario: Click +Worktree with flag enabled
- **WHEN** `gitWorktreeEnabled` is `true` AND the folder is a git repo AND a user clicks the `+Worktree` button
- **THEN** the `WorktreeSpawnDialog` SHALL open with `cwd` set to the folder's cwd

#### Scenario: Worktree preference disabled hides button
- **WHEN** `gitWorktreeEnabled` is `false`
- **THEN** the `+Worktree` button SHALL NOT render on any folder, regardless of git status
- **THEN** all other folder-action-bar buttons SHALL render unchanged

#### Scenario: Flag omitted from config treated as enabled
- **WHEN** the dashboard config has no `gitWorktreeEnabled` field
- **THEN** the client SHALL treat it as `true` (default)
- **THEN** the `+Worktree` button SHALL render on git folders (current behavior preserved)
