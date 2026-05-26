## ADDED Requirements

### Requirement: Group sessions by directory
The session list SHALL group sessions by their `cwd` value. Sessions with the same `cwd` SHALL appear together under a group header. ALL groups — including single-session groups — SHALL display a folder header. Sessions within each group SHALL be rendered in the order provided by the server's session order for that cwd.

#### Scenario: Multiple sessions in same directory
- **WHEN** two or more sessions share the same `cwd`
- **THEN** they SHALL be displayed under a group header showing the directory name

#### Scenario: Single session in a directory
- **WHEN** only one session exists for a given `cwd`
- **THEN** the session SHALL be displayed under a group header showing the directory name (same as multi-session groups), with git info on the group header

#### Scenario: Sessions across different directories
- **WHEN** sessions exist in multiple different directories
- **THEN** each directory SHALL be its own group, ordered by most recent session activity

#### Scenario: Sessions ordered within group
- **WHEN** the server provides an order for a cwd
- **THEN** sessions within that group SHALL be rendered in the server-provided order, with unordered sessions appended by startedAt descending

### Requirement: Group header display
Group headers SHALL display the full absolute directory path (with middle truncation for long paths) and git context information. Pinned groups SHALL use an MDI pin icon in the header; unpinned groups SHALL use a folder emoji.

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
Pinned directory groups SHALL show editor buttons and the "New" spawn button even when they have zero sessions. The editor detection query SHALL include pinned directory cwds.

#### Scenario: Empty pinned group with available editor
- **WHEN** a directory is pinned, has zero sessions, and an editor is detected for that path
- **THEN** the group header SHALL display the editor button

#### Scenario: Empty pinned group spawn button
- **WHEN** a directory is pinned and has zero sessions
- **THEN** the group header SHALL display the "New" spawn button

### Requirement: Symlink resolution for pinned directories
The server SHALL resolve symlinks when storing pinned directory paths so they match the resolved cwd reported by agents.

#### Scenario: Pinning a symlink path
- **WHEN** a user pins a path that contains symlinks
- **THEN** the server SHALL store the resolved real path

#### Scenario: Path does not exist on disk
- **WHEN** the pinned path does not exist on the current machine
- **THEN** the server SHALL store the original path as-is

### Requirement: Inline git info for single sessions
When a directory has only one session, git info SHALL be displayed inline beneath the session card rather than in a separate group header.

#### Scenario: Single session with git info
- **WHEN** a single session has git branch and PR information
- **THEN** the branch and PR SHALL be shown as a secondary line beneath the session card

#### Scenario: Single session without git info
- **WHEN** a single session has no git information
- **THEN** the session card SHALL display as it does currently with no additional line

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

## MODIFIED Requirements

### Requirement: Group sessions by directory
The session list SHALL group sessions by their `cwd` value. Sessions with the same `cwd` SHALL appear together under a group header. ALL groups — including single-session groups — SHALL display a folder header. Sessions within each group SHALL be rendered in the order provided by the server's session order for that cwd.

Pinned directory groups SHALL appear first, in the user-defined pinned order. Unpinned directory groups SHALL appear after pinned groups, sorted by most recent session activity (descending). Pinned directories with zero sessions SHALL still appear as groups.

The per-session group-key resolver (`resolveSessionGroupPath`) SHALL apply the following precedence (first match wins):

1. **Explicit pin wins** — if `pathKey(session.cwd)` matches a pinned entry, the session SHALL group under its own cwd.
2. **jj workspace collapse** — else if `session.jjState?.workspaceRoot` is set, the session SHALL group under that workspace root.
3. **Git worktree collapse** — else if `session.gitWorktree?.mainPath` is set, the session SHALL group under the main worktree path.
4. **Default** — else the session SHALL group under its cwd.

Sessions within a group SHALL be additionally cluster-sorted so all rows sharing the same cluster key sit adjacent. The cluster key SHALL be the first non-empty of `session.jjState?.workspaceName`, `session.gitWorktree?.name`, or the empty string (meaning "main checkout cluster"). The empty-key cluster SHALL sort first; remaining keys SHALL sort alphabetically. The existing `sortSessionsByOrder` ranking SHALL apply inside each cluster.

The clustering SHALL NOT introduce visible sub-headers or dividers between clusters — clusters remain a silent ordering of the flat session list within the folder group. (Visible sub-headers are out of scope for this change.)

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

#### Scenario: Worktree session groups under parent repo
- **WHEN** a session has `cwd = "/repo/.worktrees/feat-x"` and `gitWorktree.mainPath = "/repo"`
- **AND** `/repo` is in the pinned list AND `/repo/.worktrees/feat-x` is not pinned
- **AND** the session has no `jjState`
- **THEN** the session SHALL render inside the `/repo` group

#### Scenario: Explicit pin of worktree path wins
- **WHEN** the user has pinned `/repo/.worktrees/feat-x` AND that pin's pathKey matches the session's cwd
- **THEN** the session SHALL render under its own `/repo/.worktrees/feat-x` group, NOT inside `/repo`

#### Scenario: Both jj workspace and git worktree present
- **WHEN** a session carries both `jjState.workspaceRoot` and `gitWorktree.mainPath`
- **THEN** the session SHALL group under `jjState.workspaceRoot` (jj wins because it is step 2 in precedence)

#### Scenario: Worktree sessions cluster adjacent
- **WHEN** a folder group contains sessions from a main checkout AND from two worktrees `feat-x` and `feat-y`
- **THEN** sessions SHALL be rendered with the main-checkout cluster first, then all `feat-x` sessions adjacent, then all `feat-y` sessions adjacent
- **AND** no visible divider or sub-header SHALL appear between clusters

#### Scenario: Worktree cluster preserves session order within
- **WHEN** the server provides a session order for the folder
- **THEN** the cluster sort SHALL be stable — the server-provided order SHALL be preserved within each cluster

## MODIFIED Requirements

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

## ADDED Requirements

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

### Requirement: Workspace container rendering
The sidebar SHALL render a workspace-container tier above the existing top-level folder list. Each workspace SHALL render as a single container whose header shows the workspace name, a collapse/expand toggle reflecting the persisted `collapsed` flag, and controls to rename, delete, and add a folder. Folders inside the container SHALL render in the order given by the workspace's `folders[]` array.

#### Scenario: Workspace renders above top-level area
- **WHEN** at least one workspace exists
- **THEN** all workspace containers SHALL render above the top-level area (which itself contains pinned-non-workspace folders followed by session-discovered groups)

#### Scenario: Expanded workspace shows folders
- **WHEN** a workspace has `collapsed: false`
- **THEN** the container SHALL display the workspace header and each folder in `folders[]` order, each folder rendered using the same group-container styling as today's top-level folder groups

#### Scenario: Collapsed workspace hides folders
- **WHEN** a workspace has `collapsed: true`
- **THEN** the container SHALL display only the workspace header; folder rows SHALL NOT be rendered

#### Scenario: Collapse toggle is independent per workspace
- **WHEN** the user toggles one workspace's collapse state
- **THEN** other workspaces' collapse state SHALL be unaffected (no accordion behavior at the workspace level)

#### Scenario: Empty workspace renders header only
- **WHEN** a workspace has zero folders in `folders[]`
- **THEN** the container SHALL still render with its header, name, and controls so the user can rename, delete, or add folders to it

### Requirement: Folder visibility for workspace-owned folders
A folder assigned to a workspace SHALL render inside that workspace's container regardless of its pin state or whether any sessions currently target it. Such a folder SHALL NOT also appear in the top-level area.

#### Scenario: Workspace folder with no sessions and not pinned
- **WHEN** a folder is in a workspace's `folders[]`, is not in `pinnedDirectories`, and has zero sessions
- **THEN** the folder SHALL render inside the workspace container and SHALL NOT render at the top level

#### Scenario: Workspace folder that is also pinned
- **WHEN** a folder is in both a workspace's `folders[]` and `pinnedDirectories`
- **THEN** the folder SHALL render only inside the workspace container and SHALL NOT appear in the top-level pinned region

#### Scenario: Workspace folder with active sessions
- **WHEN** a folder is in a workspace's `folders[]` and has one or more active sessions
- **THEN** sessions SHALL render inside the workspace container under that folder's group header, not at the top level

#### Scenario: Folder removed from workspace, still pinned
- **WHEN** a folder is removed from its workspace and remains in `pinnedDirectories`
- **THEN** the folder SHALL reappear in the top-level pinned region in its existing pin-order position

#### Scenario: Folder removed from workspace, not pinned, no sessions
- **WHEN** a folder is removed from its workspace, is not in `pinnedDirectories`, and has no active sessions
- **THEN** the folder SHALL disappear from the sidebar

### Requirement: Folder ordering inside a workspace
Folders inside a workspace SHALL render in the order stored in `workspaces[i].folders`. Pin order and recency SHALL have no effect on intra-workspace order.

#### Scenario: User-defined order wins over pin order
- **WHEN** a workspace's `folders[]` is `["/x", "/y"]` and `pinnedDirectories` is `["/y", "/x"]`
- **THEN** the workspace SHALL display folders in the order `/x` then `/y`

#### Scenario: Reorder updates display
- **WHEN** the server emits `workspaces_updated` after a `reorder_workspace_folders` mutation
- **THEN** the workspace SHALL re-render folders in the new order

### Requirement: Top-level area unchanged for non-workspace folders
The top-level area SHALL continue to apply today's pinned-first-then-session-driven rule, restricted to folders that are NOT in any workspace's `folders[]`.

#### Scenario: Non-workspace pinned folder renders at top level
- **WHEN** a folder is in `pinnedDirectories` and not in any workspace
- **THEN** the folder SHALL render in the top-level pinned region in pin-order position

#### Scenario: Non-workspace session-driven folder renders at top level
- **WHEN** a folder has active sessions and is in no workspace and not pinned
- **THEN** the folder SHALL render in the top-level area sorted by most recent session activity, exactly as it does today

#### Scenario: No workspaces exist
- **WHEN** the user has not created any workspaces
- **THEN** the sidebar SHALL render exactly as it does today, with no workspace-tier UI elements
