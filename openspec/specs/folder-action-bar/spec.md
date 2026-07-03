# folder-action-bar Specification

## Purpose

Define the folder-group action bar and elevated spawn buttons rendered in the sidebar.
## Requirements
### Requirement: Folder action bar layout
Each folder group in the sidebar SHALL render a horizontal action bar below the group header containing buttons in this order: `Terminals(N)`, `Editor`, native editors (e.g. `Zed`), `Clean up broken (N)` (conditional), and Pi Resources (right-aligned). The action bar SHALL NOT contain `+Session` or `+Worktree` buttons — those are relocated to the elevated spawn-button stack (see "Elevated folder spawn buttons").

#### Scenario: Action bar omits spawn buttons
- **WHEN** a folder group action bar is rendered for a git repository with Zed detected
- **THEN** the action bar SHALL display: Terminals(0), Editor, Zed, and the Pi Resources icon
- **THEN** the action bar SHALL NOT contain a `+Session` button
- **THEN** the action bar SHALL NOT contain a `+Worktree` button
- **THEN** the action bar SHALL NOT contain a `+Terminal` button

#### Scenario: Zed not detected
- **WHEN** a folder group is rendered and Zed is not detected
- **THEN** the Zed button SHALL NOT appear in the action bar
- **THEN** all other action-bar buttons SHALL remain visible

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

### Requirement: Initialize button gated on worktree-init status

For a row whose repo declares a worktree-init hook (`hasHook: true`), the row SHALL display an "Initialize" button when, and only when, the cached worktree-init status reports `needsInit: true`. When `hasHook` is true and `needsInit` is false, the Initialize button SHALL NOT be shown. Behavior for rows with no declared hook (`hasHook: false`) is governed by a separate capability and is out of scope here. Init-status SHALL be probed lazily per row and fail-open (on probe error the button is hidden).

Clicking Initialize SHALL run the hook via `POST /api/git/worktree/init`. When the hook is untrusted, the client SHALL first show a trust-confirm dialog naming the gate and the run command (or agent prompt + model); on confirm it SHALL re-issue the run with `confirmHash`. Hook progress SHALL stream to a live tail. A hook failure SHALL render in a card reusing the spawn-error card surface (stderr / log tail). On success the client SHALL re-fetch init-status, after which the gate flips and the Initialize button disappears.

#### Scenario: Button shown when init needed

- **WHEN** a row's init-status is `{ hasHook: true, needsInit: true }`
- **THEN** the row SHALL show an "Initialize" button

#### Scenario: Button hidden when already initialized

- **WHEN** a row's init-status is `{ hasHook: true, needsInit: false }`
- **THEN** the row SHALL NOT show an "Initialize" button

#### Scenario: Untrusted hook prompts before running

- **WHEN** the user clicks Initialize for an untrusted hook
- **THEN** the client SHALL show a trust-confirm dialog naming the gate and run command/prompt
- **AND** SHALL only run the hook (with `confirmHash`) after the user confirms

#### Scenario: Failure renders a card

- **WHEN** a hook run fails
- **THEN** the client SHALL render the failure in a card with the stderr / log tail

#### Scenario: Success removes the button

- **WHEN** a hook run succeeds
- **THEN** the client SHALL re-fetch init-status
- **AND** the Initialize button SHALL disappear once the gate reports `needsInit: false`

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

### Requirement: Initialize button routes unconfigured directories to project-init

For a directory / worktree row whose repo declares NO worktree-init hook (worktree-init-status `hasHook: false`), the row SHALL show an "Initialize" button that, when clicked, spawns an interactive project-init session in that directory (cwd = the row's path), reusing the existing spawn-session machinery with the project-init skill pre-injected. This complements the hook-present behavior: for rows with a declared hook the gate-gated hook-run behavior applies instead.

#### Scenario: No-hook row shows Initialize routing to the skill

- **WHEN** a row's worktree-init-status is `{ hasHook: false }`
- **THEN** the row SHALL show an "Initialize" button
- **AND** clicking it SHALL spawn an interactive project-init session with cwd set to the row's directory

#### Scenario: Hook-present row is unaffected

- **WHEN** a row's worktree-init-status is `{ hasHook: true }`
- **THEN** the Initialize button SHALL follow the hook-run behavior (not the project-init skill)

#### Scenario: Project-init session is first-class

- **WHEN** the project-init session is spawned from the Initialize button
- **THEN** it SHALL appear as a normal dashboard session (visible transcript, abortable)
- **AND** SHALL NOT be a detached process

