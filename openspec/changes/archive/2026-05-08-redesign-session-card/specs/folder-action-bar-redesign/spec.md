## Purpose

[Spec purpose]

## ADDED Requirements

### Requirement: Folder action bar — simplified layout
Each folder group in the sidebar SHALL render an action bar containing only primary actions directly visible. On desktop (>= 768px), secondary actions SHALL be grouped in a single dropdown menu. On mobile (< 768px), only primary actions SHALL be visible.

#### Scenario: Desktop action bar
- **WHEN** viewport >= 768px
- **THEN** the action bar SHALL display: +Session button, +Worktree button (if enabled), and a "Tools" dropdown button

#### Scenario: Mobile action bar
- **WHEN** viewport < 768px
- **THEN** the action bar SHALL display only: +Session button and +Worktree button (if enabled)
- **AND** no dropdown menu SHALL be present

### Requirement: +Session button — unchanged semantics
The +Session button SHALL spawn a new pi session in the folder's cwd. It SHALL be disabled while a session is being spawned. Existing behavior is preserved, styling updated to match the redesign.

#### Scenario: Spawn session
- **WHEN** user clicks +Session
- **THEN** a new pi session SHALL be spawned in the folder's cwd

### Requirement: +Worktree button — unchanged semantics
The +Worktree button SHALL spawn a pi session in a git worktree. It SHALL be disabled while a session is being spawned. It SHALL only appear when the `onSpawnWorktree` prop is provided.

#### Scenario: Worktree button present
- **WHEN** onSpawnWorktree prop is provided
- **THEN** the +Worktree button SHALL render

#### Scenario: Worktree button absent
- **WHEN** onSpawnWorktree prop is not provided
- **THEN** the +Worktree button SHALL NOT render

### Requirement: Tools dropdown — desktop only
On desktop viewports, a "Tools" dropdown button SHALL group the following secondary actions:
- Terminals (with count badge, e.g., "Terminals (2)")
- Editor (with status indicator: green dot when running, pulsing dot when starting, warning when not found)
- Native editor entries (one per detected editor, e.g., "Zed")
- Pi Resources

Clicking a dropdown item SHALL trigger the same action as the current individual buttons.

#### Scenario: Tools dropdown displays terminal count
- **WHEN** a folder has 3 active terminals
- **THEN** the dropdown SHALL show "Terminals (3)"

#### Scenario: Tools dropdown displays editor status
- **WHEN** code-server is running for the folder
- **THEN** the dropdown SHALL show a green dot next to "Editor"

#### Scenario: Tools dropdown displays native editors
- **WHEN** Zed is detected as running
- **THEN** the dropdown SHALL show "Zed" as a clickable item

#### Scenario: Tools dropdown displays Pi Resources
- **WHEN** the dropdown is open
- **THEN** "Pi Resources" SHALL be a clickable item

#### Scenario: Dropdown item click triggers action
- **WHEN** user clicks "Terminals (2)" in the dropdown
- **THEN** the content area SHALL navigate to the terminals view

### Requirement: Removed elements from action bar
The FolderActionBar SHALL NOT render any of the following as standalone buttons:
- Terminals button (moved to dropdown on desktop, removed on mobile)
- Editor button (moved to dropdown on desktop, removed on mobile)
- Native editor buttons like Zed (moved to dropdown on desktop, removed on mobile)
- Pi Resources button (moved to dropdown on desktop, removed on mobile)

#### Scenario: No standalone terminal button
- **WHEN** the action bar renders
- **THEN** there SHALL NOT be a standalone Terminals button outside the dropdown

#### Scenario: No standalone editor button
- **WHEN** the action bar renders
- **THEN** there SHALL NOT be a standalone Editor button outside the dropdown

#### Scenario: No standalone native editor buttons
- **WHEN** the action bar renders
- **THEN** there SHALL NOT be standalone native editor buttons outside the dropdown

### Requirement: Dropdown mechanism
The Tools dropdown SHALL use a standard HTML `<details>` + `<summary>` element or the Popover API. It SHALL close when clicking outside. On mobile, the dropdown SHALL NOT render at all.

#### Scenario: Dropdown opens on click
- **WHEN** user clicks the Tools button
- **THEN** the dropdown menu SHALL become visible

#### Scenario: Dropdown closes on outside click
- **WHEN** the dropdown is open and user clicks outside
- **THEN** the dropdown SHALL close
