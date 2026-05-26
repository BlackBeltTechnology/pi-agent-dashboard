## MODIFIED Requirements

### Requirement: Folder action bar layout
Each folder group in the sidebar SHALL render a horizontal action bar below the group header containing buttons in this order: `+Session`, `+Worktree`, `Terminals(N)`, `Editor`, `Zed`, and Pi Resources (right-aligned). The action bar SHALL replace the current scattered button layout.

The `+Worktree` button SHALL be hidden when the folder is not detected as a git repository (no `gitBranch` on any session under that folder). The button is hidden, not disabled.

#### Scenario: All buttons visible with detected editors
- **WHEN** a folder group is rendered for a git repository and Zed is detected as a running native editor
- **THEN** the action bar SHALL display: +Session, +Worktree, Terminals(0), Editor, Zed, and Pi Resources icon
- **THEN** buttons SHALL be arranged horizontally with consistent spacing

#### Scenario: Non-git folder hides +Worktree
- **WHEN** a folder group is rendered for a directory that is not a git repository
- **THEN** the +Worktree button SHALL NOT appear
- **THEN** all other buttons SHALL render as before

#### Scenario: Zed not detected
- **WHEN** a folder group is rendered and Zed is not detected
- **THEN** the Zed button SHALL NOT appear in the action bar
- **THEN** all other buttons SHALL remain visible

## ADDED Requirements

### Requirement: +Worktree button opens worktree dialog
The `+Worktree` button in the folder action bar SHALL open the worktree spawn dialog (`WorktreeSpawnDialog`) scoped to the folder's cwd. The button's visibility SHALL NOT be gated on browser-side loopback detection — the worktree-add executes on the server (the user's own machine in every access mode), so a tunneled or remote-authenticated browser is functionally identical to a local one. Access control for the underlying `POST /api/git/worktree` endpoint is enforced server-side by the network guard.

#### Scenario: Click +Worktree
- **WHEN** a user clicks the `+Worktree` button on a git folder's action bar
- **THEN** the `WorktreeSpawnDialog` SHALL open with `cwd` set to the folder's cwd

#### Scenario: Button renders identically for local and tunneled browsers
- **WHEN** the dashboard is accessed from a non-loopback URL (e.g. via zrok)
- **AND** the folder is a git repository
- **THEN** the `+Worktree` button SHALL still appear and remain functional
