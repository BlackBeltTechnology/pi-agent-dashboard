# folder-action-bar Specification

## Purpose

Define the folder-group action bar and elevated spawn buttons rendered in the sidebar.
## Requirements
### Requirement: Folder action bar layout

Each folder group in the sidebar SHALL render a horizontal action bar below the group header containing buttons in this order: `Terminals(N)`, `Editor`, `Clean up broken (N)` (conditional), and Pi Resources (right-aligned). The action bar SHALL NOT contain native-editor (e.g. `Zed`) buttons, `+Session`, or `+Worktree` buttons — native-editor launch is removed, and spawn buttons live in the elevated spawn-button stack.

#### Scenario: Action bar omits native-editor and spawn buttons

- **WHEN** a folder group action bar is rendered for a git repository
- **THEN** the action bar SHALL display: Terminals(0), Editor, and the Pi Resources icon
- **THEN** the action bar SHALL NOT contain a `Zed` (or any native-editor) button
- **THEN** the action bar SHALL NOT contain a `+Session` button
- **THEN** the action bar SHALL NOT contain a `+Worktree` button

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

### Requirement: Editor button opens the internal folder pane

The Editor button SHALL navigate to `/folder/:encodedCwd/editor`, which mounts the internal Monaco editor pane rooted at the folder cwd (see capability `folder-scoped-editor-pane`). The button SHALL NOT display any `code-server` status indicator (green/pulsing/warning), because no external editor process exists.

#### Scenario: Click navigates to the internal folder pane

- **WHEN** the user clicks the Editor button
- **THEN** the content area SHALL navigate to `/folder/:encodedCwd/editor`
- **AND** the internal Monaco pane SHALL mount rooted at the folder cwd

#### Scenario: Editor button has no status indicator

- **WHEN** the Editor button is rendered for any folder
- **THEN** it SHALL NOT display a green/pulsing dot or a yellow warning icon

### Requirement: Pi Resources button with updated icon
The Pi Resources button SHALL be right-aligned in the action bar and use a more representative icon (replacing `mdiPuzzleOutline`). Clicking it SHALL open the PiResourcesView (existing behavior, relocated).

#### Scenario: Open Pi Resources
- **WHEN** user clicks the Pi Resources icon
- **THEN** the PiResourcesView SHALL open for the folder's cwd

### Requirement: Initialize button gated on worktree-init status

For a row whose repo declares a worktree-init hook (`hasHook: true`), the row SHALL display the init control when the cached worktree-init status reports `needsInit: true` OR the hook is not trusted (`trusted: false`). When `hasHook` is true, `needsInit` is false, and the hook is trusted, the control SHALL NOT be shown. The control SHALL label itself by reason: "Initialize" when `needsInit: true`; "Review & trust changes" when `needsInit: false` and `trusted: false` (the hook was edited after it was last trusted, invalidating its `repoRoot + sha256(canonical(worktreeInit))` trust key). Behavior for rows with no declared hook (`hasHook: false`) is governed by a separate capability and is out of scope here. Init-status SHALL be probed lazily per row and fail-open (on probe error the button is hidden).

Clicking Initialize SHALL run the hook via `POST /api/git/worktree/init`. When the hook is untrusted, the client SHALL first show a trust-confirm dialog naming the gate and the run command (or agent prompt + model); on confirm it SHALL re-issue the run with `confirmHash`. While the hook runs, the row SHALL show a status chip (label + elapsed time) with the last log line as a muted preview; the full log SHALL be opt-in behind a collapsed disclosure, NOT rendered inline as a raw output block. A hook failure SHALL render as a compact chip with a plain-language summary (exit code + short command) and a Retry action, with the stderr / log tail available behind the same opt-in disclosure; the failure chip SHALL NOT auto-dismiss on a timer. On success the client SHALL briefly show a success confirmation, then re-fetch init-status, after which the gate flips and the Initialize button disappears.

#### Scenario: Button shown when init needed

- **WHEN** a row's init-status is `{ hasHook: true, needsInit: true }`
- **THEN** the row SHALL show the control labeled "Initialize"

#### Scenario: Button labeled for re-trust when hook edited

- **WHEN** a row's init-status is `{ hasHook: true, needsInit: false, trusted: false }` (the hook was edited after last trust, invalidating its trust key)
- **THEN** the row SHALL show the control labeled "Review & trust changes" (not "Initialize")
- **AND** clicking it SHALL open the trust-confirm dialog; granting trust SHALL clear the control without running an init when the gate reports `needsInit: false`

#### Scenario: Button hidden when initialized and trusted

- **WHEN** a row's init-status is `{ hasHook: true, needsInit: false, trusted: true }`
- **THEN** the row SHALL NOT show the init control

#### Scenario: Untrusted hook prompts before running

- **WHEN** the user clicks Initialize for an untrusted hook
- **THEN** the client SHALL show a trust-confirm dialog naming the gate and run command/prompt
- **AND** SHALL only run the hook (with `confirmHash`) after the user confirms

#### Scenario: Running shows a status chip with opt-in log

- **WHEN** a hook run is in flight
- **THEN** the row SHALL show a status chip with elapsed time and the last log line as a muted preview
- **AND** the full log SHALL be hidden until the user opens the disclosure (no inline raw output block)

#### Scenario: Failure renders a compact, retryable chip

- **WHEN** a hook run fails
- **THEN** the client SHALL render a compact failure chip with a plain-language summary and a Retry action
- **AND** the stderr / log tail SHALL be available behind an opt-in disclosure
- **AND** the failure chip SHALL NOT auto-dismiss on a timer

#### Scenario: Success removes the button

- **WHEN** a hook run succeeds
- **THEN** the client SHALL briefly show a success confirmation, then re-fetch init-status
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

For a directory / worktree row whose worktree-init-status reports `{ hasHook: false, configured: false }` (no declared hook AND not yet a configured pi project), the row SHALL show a "Set up project" button, rendered by a dedicated `ProjectInitButton` component distinct from the hook-run `WorktreeInitButton`. The `ProjectInitButton` SHALL carry its own label ("Set up project"), icon, and neutral/primary color — visually distinct from the amber, repo-code-executing hook-run control — so the scaffold action and the hook-run action are never confusable. Clicking it SHALL spawn an interactive project-init session in that directory (cwd = the row's path), reusing the existing spawn-session machinery with the project-init skill pre-injected.

For a row reporting `{ hasHook: false, configured: true }` (already a configured pi project that declares no worktree-init hook), the row SHALL render NO initialize control of either kind — there is nothing to initialize.

For a row reporting `{ hasHook: true }`, the hook-run behavior applies (governed by "Initialize button gated on worktree-init status"), NOT the project-init scaffold.

#### Scenario: Unconfigured row shows Set up project routing to the skill

- **WHEN** a row's worktree-init-status is `{ hasHook: false, configured: false }`
- **THEN** the row SHALL show a "Set up project" button rendered by `ProjectInitButton`
- **AND** the button SHALL be visually distinct (label, icon, color) from the hook-run Initialize control
- **AND** clicking it SHALL spawn an interactive project-init session with cwd set to the row's directory

#### Scenario: Configured-but-hookless row shows nothing

- **WHEN** a row's worktree-init-status is `{ hasHook: false, configured: true }`
- **THEN** the row SHALL NOT show a "Set up project" button
- **AND** the row SHALL NOT show a hook-run Initialize button

#### Scenario: Hook-present row is unaffected

- **WHEN** a row's worktree-init-status is `{ hasHook: true }`
- **THEN** the initialize control SHALL follow the hook-run behavior (not the project-init scaffold)

#### Scenario: Project-init session is first-class

- **WHEN** the project-init session is spawned from the `ProjectInitButton`
- **THEN** it SHALL appear as a normal dashboard session (visible transcript, abortable)
- **AND** SHALL NOT be a detached process

