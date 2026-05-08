## MODIFIED Requirements

### Requirement: Folder action bar layout
Each folder group in the sidebar SHALL render a horizontal action bar. On desktop (>= 768px), the action bar SHALL display: +Session button, +Worktree button (if enabled), and a "Tools" dropdown containing Terminals, Editor, native editors, and Pi Resources. On mobile (< 768px), it SHALL display only +Session and +Worktree buttons.

#### Scenario: Desktop action bar
- **WHEN** viewport >= 768px
- **THEN** the action bar SHALL display +Session, +Worktree (if enabled), and Tools dropdown
- **THEN** there SHALL NOT be standalone Terminals, Editor, Zed, or Pi Resources buttons

#### Scenario: Mobile action bar
- **WHEN** viewport < 768px
- **THEN** the action bar SHALL display only +Session and +Worktree (if enabled)
- **AND** there SHALL NOT be a Tools dropdown

### Requirement: +Session button
The +Session button SHALL spawn a new pi session in the folder's cwd. It SHALL be disabled while a session is being spawned.

#### Scenario: Spawn session
- **WHEN** user clicks +Session
- **THEN** a new pi session SHALL be spawned in the folder's cwd
- **THEN** the button SHALL be disabled until the session appears

## ADDED Requirements

### Requirement: Tools dropdown on desktop
The Tools dropdown SHALL group Terminals, Editor, native editors, and Pi Resources into a single expandable menu. Each item SHALL trigger its corresponding action on click.

#### Scenario: Terminals with count
- **WHEN** a folder has 2 active terminals
- **THEN** the dropdown SHALL show "Terminals (2)"

#### Scenario: Editor with status
- **WHEN** code-server is running
- **THEN** the dropdown SHALL show a green dot next to "Editor"

#### Scenario: Native editors listed
- **WHEN** Zed is detected
- **THEN** the dropdown SHALL show "Zed" as a clickable item

#### Scenario: Pi Resources listed
- **WHEN** the dropdown is open
- **THEN** "Pi Resources" SHALL be a clickable item

## REMOVED Requirements

### Requirement: Terminals button with count badge
**Reason**: Replaced by Tools dropdown.
**Migration**: Access via Tools dropdown on desktop.

### Requirement: Editor button with status indicator
**Reason**: Replaced by Tools dropdown.
**Migration**: Access via Tools dropdown on desktop.

### Requirement: Zed button for native launch
**Reason**: Replaced by Tools dropdown.
**Migration**: Access via Tools dropdown on desktop.

### Requirement: Pi Resources button with updated icon
**Reason**: Replaced by Tools dropdown.
**Migration**: Access via Tools dropdown on desktop.
