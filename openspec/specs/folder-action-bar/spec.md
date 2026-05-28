## ADDED Requirements

### Requirement: Folder action bar layout
Each folder group in the sidebar SHALL render a horizontal action bar below the group header containing buttons in this order: `+Session`, `+Worktree`, `Terminals(N)`, `Editor`, `Zed`, and Pi Resources (right-aligned). The action bar SHALL replace the current scattered button layout.

The `+Worktree` button SHALL be hidden when the folder is not detected as a git repository (no `gitBranch` on any session under that folder). The button is hidden, not disabled.

#### Scenario: All buttons visible with detected editors
- **WHEN** a folder group is rendered for a git repository and Zed is detected as a running native editor
- **THEN** the action bar SHALL display: +Session, +Worktree, Terminals(0), Editor, Zed, and Pi Resources icon
- **THEN** buttons SHALL be arranged horizontally with consistent spacing
- **THEN** the action bar SHALL NOT contain a `+Terminal` button

#### Scenario: Non-git folder hides +Worktree
- **WHEN** a folder group is rendered for a directory that is not a git repository
- **THEN** the +Worktree button SHALL NOT appear
- **THEN** all other buttons SHALL render as before

#### Scenario: Zed not detected
- **WHEN** a folder group is rendered and Zed is not detected
- **THEN** the Zed button SHALL NOT appear in the action bar
- **THEN** all other buttons SHALL remain visible

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

### Requirement: +Session button
The +Session button SHALL spawn a new pi session in the folder's cwd. It SHALL be disabled while a session is being spawned (existing behavior, relocated).

#### Scenario: Spawn session
- **WHEN** user clicks +Session
- **THEN** a new pi session SHALL be spawned in the folder's cwd
- **THEN** the button SHALL be disabled until the session appears

### Requirement: Terminals button with count badge
The Terminals button SHALL display the count of open terminals for the folder as a badge (e.g., `Terminals(3)`). Clicking it SHALL navigate to the TerminalsView. When no terminals exist, the badge SHALL show 0.

#### Scenario: Navigate to terminals view
- **WHEN** user clicks Terminals(N)
- **THEN** the content area SHALL navigate to `/folder/:encodedCwd/terminals`

#### Scenario: Badge reflects terminal count
- **WHEN** a folder has 3 active terminals
- **THEN** the Terminals button SHALL display `Terminals(3)`

#### Scenario: No terminals exist
- **WHEN** a folder has no terminals
- **THEN** the Terminals button SHALL display `Terminals(0)`

### Requirement: Editor button with status indicator
The Editor button SHALL navigate to the EditorView for the folder. It SHALL display a status indicator: green dot when code-server is running, pulsing dot when starting, yellow warning icon when code-server binary is not found, no indicator when stopped.

#### Scenario: Editor running
- **WHEN** a code-server instance is running for the folder
- **THEN** the Editor button SHALL display a green dot indicator

#### Scenario: Editor starting
- **WHEN** a code-server instance is starting for the folder
- **THEN** the Editor button SHALL display a pulsing dot indicator

#### Scenario: Editor stopped
- **WHEN** no code-server instance exists for the folder
- **THEN** the Editor button SHALL display no indicator

#### Scenario: code-server not found
- **WHEN** code-server binary is not detected on the system
- **THEN** the Editor button SHALL display a yellow warning icon

#### Scenario: Click navigates to editor
- **WHEN** user clicks the Editor button
- **THEN** the content area SHALL navigate to `/folder/:encodedCwd/editor`

### Requirement: Zed button for native launch
The Zed button SHALL launch Zed natively via the existing `POST /api/open-editor` endpoint. It SHALL NOT cause any content area navigation. It SHALL only appear when Zed is detected as running.

#### Scenario: Launch Zed
- **WHEN** user clicks the Zed button
- **THEN** the system SHALL call `POST /api/open-editor` with `{ path: cwd, editor: "zed" }`
- **THEN** no content area navigation SHALL occur

### Requirement: Pi Resources button with updated icon
The Pi Resources button SHALL be right-aligned in the action bar and use a more representative icon (replacing `mdiPuzzleOutline`). Clicking it SHALL open the PiResourcesView (existing behavior, relocated).

#### Scenario: Open Pi Resources
- **WHEN** user clicks the Pi Resources icon
- **THEN** the PiResourcesView SHALL open for the folder's cwd
