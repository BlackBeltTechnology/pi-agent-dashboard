## Purpose

[Spec purpose]
## Requirements
### Requirement: Group sessions by directory
The session list SHALL group sessions by their `cwd` value. Sessions with the same `cwd` SHALL appear together under a group header. ALL groups — including single-session groups — SHALL display a folder header. Sessions within each group SHALL be rendered in the order provided by the server's session order for that cwd.

Pinned directory groups SHALL appear first, in the user-defined pinned order. Unpinned directory groups SHALL appear after pinned groups, sorted by most recent session activity (descending). Pinned directories with zero sessions SHALL still appear as groups.

#### Scenario: Multiple sessions in same directory
- **WHEN** two or more sessions share the same `cwd`
- **THEN** they SHALL be displayed under a group header showing the directory name

#### Scenario: Single session in a directory
- **WHEN** only one session exists for a given `cwd`
- **THEN** the session SHALL be displayed under a group header showing the directory name (same as multi-session groups), with git info on the group header

#### Scenario: Pinned directories appear first
- **WHEN** both pinned and unpinned directory groups exist
- **THEN** pinned groups SHALL appear above unpinned groups, in the user-defined pinned order

#### Scenario: Unpinned directories sorted by recency
- **WHEN** unpinned directory groups exist
- **THEN** they SHALL be ordered by most recent session activity (descending), after all pinned groups

#### Scenario: Pinned directory with no sessions
- **WHEN** a directory is pinned but has no sessions matching that cwd
- **THEN** a group SHALL still be rendered for that directory, showing zero sessions

#### Scenario: Sessions ordered within group
- **WHEN** the server provides an order for a cwd
- **THEN** sessions within that group SHALL be rendered in the server-provided order, with unordered sessions appended by startedAt descending

### Requirement: Group header display
Group headers SHALL display the full absolute directory path (with middle truncation for long paths) and git context information.

#### Scenario: Group with git branch and PR
- **WHEN** a group's sessions have git branch and PR information
- **THEN** the group header SHALL show the full directory path, branch name as a clickable link, and PR number as a clickable link

#### Scenario: Group with branch only
- **WHEN** a group's sessions have git branch but no PR
- **THEN** the group header SHALL show the full directory path and branch name (as link if URL available, otherwise plain text)

#### Scenario: Group without git info
- **WHEN** a group's sessions have no git information
- **THEN** the group header SHALL show only the full directory path

#### Scenario: Long path display
- **WHEN** the full directory path exceeds the display threshold
- **THEN** the path SHALL be middle-truncated with "…", preserving the leading prefix and final directory name

### Requirement: Pinned group controls
Pinned directory groups SHALL show editor buttons and the "New" spawn button even when they have zero sessions. The editor detection query SHALL include pinned directory cwds in addition to session-derived cwds.

#### Scenario: Empty pinned group with available editor
- **WHEN** a directory is pinned and has zero sessions and an editor (e.g., Zed) is detected for that path
- **THEN** the group header SHALL display the editor button

#### Scenario: Empty pinned group spawn button
- **WHEN** a directory is pinned and has zero sessions
- **THEN** the group header SHALL display the "New" spawn button

#### Scenario: Empty pinned group with no editor
- **WHEN** a directory is pinned, has zero sessions, and no editor is detected
- **THEN** the group header SHALL display only the "New" spawn button without editor buttons

### Requirement: Symlink resolution for pinned directories
The server SHALL resolve symlinks when storing pinned directory paths so they match the resolved cwd reported by agents.

#### Scenario: Pinning a symlink path
- **WHEN** a user pins a path that contains symlinks
- **THEN** the server SHALL store the resolved real path

#### Scenario: Path does not exist on disk
- **WHEN** the pinned path does not exist on the current machine
- **THEN** the server SHALL store the original path as-is

### Requirement: Folder group visual container
Each folder group SHALL be rendered as a visually distinct container with `bg-[var(--bg-secondary)]` background, `rounded-lg` corners, and internal padding. The container SHALL wrap both the folder header and all session cards within the group.

#### Scenario: Folder group with multiple sessions
- **WHEN** a folder group contains two or more sessions
- **THEN** the group SHALL render as a single container with `bg-[var(--bg-secondary)]` background, `rounded-lg` corners, containing the header and all session cards

#### Scenario: Folder group with single session
- **WHEN** a folder group contains one session
- **THEN** the group SHALL render as a container with the same styling as multi-session groups

#### Scenario: Empty pinned folder group
- **WHEN** a pinned folder group has zero sessions
- **THEN** the group SHALL still render as a container with `bg-[var(--bg-secondary)]` background and `rounded-lg` corners

### Requirement: Inter-group spacing
Folder group containers SHALL be separated by vertical spacing so they read as distinct blocks within the sidebar.

#### Scenario: Multiple folder groups visible
- **WHEN** the sidebar displays two or more folder groups
- **THEN** there SHALL be visible vertical gap between each group container

### Requirement: No border-b on folder header
The folder header within a group container SHALL NOT use a `border-b` bottom border, since the container background and spacing handle visual separation.

#### Scenario: Folder header rendering
- **WHEN** a folder header is rendered inside a group container
- **THEN** the header SHALL NOT have a bottom border separating it from session cards below

### Requirement: Pinned groups with zero sessions show group controls
Pinned directory groups SHALL show editor buttons and the "New" spawn button even when they have zero sessions. The editor detection query SHALL include pinned directory cwds in addition to session-derived cwds.

#### Scenario: Empty pinned group with available editor
- **WHEN** a directory is pinned and has zero sessions and an editor (e.g., Zed) is detected for that path
- **THEN** the group header SHALL display the editor button

#### Scenario: Empty pinned group spawn button
- **WHEN** a directory is pinned and has zero sessions
- **THEN** the group header SHALL display the "New" spawn button

#### Scenario: Empty pinned group with no editor
- **WHEN** a directory is pinned, has zero sessions, and no editor is detected
- **THEN** the group header SHALL display only the "New" spawn button without editor buttons

### Requirement: Drag-to-reorder removed
Drag-to-reorder of session cards within folder groups SHALL be removed. Sessions SHALL be ordered by the server (last active at top) without user reordering.

#### Scenario: No drag handles
- **WHEN** session cards render in the sidebar
- **THEN** no drag handles SHALL appear on session cards

#### Scenario: Session order is server-managed
- **WHEN** a new session is spawned
- **THEN** it SHALL appear at the top of its folder group

