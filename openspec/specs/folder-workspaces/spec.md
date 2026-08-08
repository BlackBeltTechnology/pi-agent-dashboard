# folder-workspaces Specification

## Purpose

Named containers grouping multiple folders in sidebar. Persist in `preferences.json` alongside `pinnedDirectories` and `sessionOrder`. Single-membership invariant: folder belongs to at most one workspace. Pin state and workspace membership orthogonal.
## Requirements
### Requirement: Workspace persistence
The server SHALL persist workspaces as a `workspaces` array in `~/.pi/dashboard/preferences.json` alongside the existing `pinnedDirectories` and `sessionOrder` fields. Each workspace record SHALL have shape `{ id: string, name: string, collapsed: boolean, folders: string[] }`. The array SHALL be loaded on server startup and written atomically via the existing debounced writer on every mutation.

#### Scenario: Server startup with no workspaces field
- **WHEN** the server starts and `preferences.json` exists but has no `workspaces` field
- **THEN** the in-memory workspaces list SHALL initialize as an empty array and no migration error SHALL occur

#### Scenario: Server startup with workspaces field
- **WHEN** the server starts and `preferences.json` contains `workspaces: [...]`
- **THEN** the records SHALL be loaded into memory in array order with all fields preserved

#### Scenario: Workspaces survive server restart
- **WHEN** workspaces exist and the server is restarted
- **THEN** every workspace record (id, name, collapsed flag, folder list with order) SHALL be restored from `preferences.json`

#### Scenario: Mutation triggers debounced persistence
- **WHEN** any workspace mutation occurs (create, rename, delete, collapse, folder add/remove/reorder, workspace reorder)
- **THEN** the server SHALL schedule a debounced write to `preferences.json` and the new state SHALL appear on disk within the existing debounce window

### Requirement: Workspace creation
The server SHALL create a new workspace with a server-generated id (`ws_<uuid>`), the supplied name (trimmed, 1–80 chars), `collapsed: false`, and an empty `folders[]`. Browsers SHALL NOT propose workspace ids.

#### Scenario: Create workspace with valid name
- **WHEN** a browser sends `{ type: "create_workspace", name: "client-work" }`
- **THEN** the server SHALL append a new workspace record with a freshly generated `ws_<uuid>` id, name "client-work", `collapsed: false`, and `folders: []`, persist it, and broadcast `workspaces_updated`

#### Scenario: Create workspace with empty name
- **WHEN** a browser sends `create_workspace` with an empty or whitespace-only name
- **THEN** the server SHALL reject the request without mutating state

#### Scenario: Create workspace with duplicate name
- **WHEN** a workspace named "scratch" already exists and a browser creates another workspace named "scratch"
- **THEN** the server SHALL create the second workspace successfully (name uniqueness is not enforced)

### Requirement: Workspace rename
The server SHALL update a workspace's `name` field, preserving id, collapsed flag, and folder membership.

#### Scenario: Rename existing workspace
- **WHEN** a browser sends `{ type: "rename_workspace", id, name: "API Server" }` for an existing workspace
- **THEN** the server SHALL update the name, persist, and broadcast `workspaces_updated`

#### Scenario: Rename non-existent workspace
- **WHEN** a browser sends `rename_workspace` with an unknown id
- **THEN** the server SHALL leave state unchanged and SHALL NOT broadcast

### Requirement: Workspace deletion
The server SHALL remove a workspace record. Folders previously assigned to it SHALL revert to top-level visibility rules.

#### Scenario: Delete workspace with folders
- **WHEN** a browser sends `{ type: "delete_workspace", id }` for a workspace containing folders
- **THEN** the workspace record SHALL be removed from the array, the folders SHALL no longer be associated with any workspace, `pinnedDirectories` SHALL be unchanged, and `workspaces_updated` SHALL be broadcast

#### Scenario: Delete non-existent workspace
- **WHEN** a browser sends `delete_workspace` with an unknown id
- **THEN** the server SHALL leave state unchanged and SHALL NOT broadcast

### Requirement: Workspace collapsed flag
The server SHALL persist a per-workspace `collapsed` boolean, controllable via WebSocket message, broadcast to all browsers.

#### Scenario: Collapse a workspace
- **WHEN** a browser sends `{ type: "set_workspace_collapsed", id, collapsed: true }`
- **THEN** the workspace's `collapsed` field SHALL be updated, persisted, and broadcast via `workspaces_updated`

#### Scenario: Collapsed flag survives restart
- **WHEN** a workspace is collapsed and the server restarts
- **THEN** the workspace SHALL still report `collapsed: true` on reload

#### Scenario: Multiple workspaces independently collapsed
- **WHEN** two workspaces exist and one is collapsed while the other is expanded
- **THEN** their `collapsed` flags SHALL be independent (no accordion semantics at the workspace level)

### Requirement: Folder assignment to a workspace
The server SHALL maintain the invariant that each folder path belongs to at most one workspace. Adding a folder to a workspace SHALL first detach it from any other workspace that currently contains it. Folder paths SHALL be normalized and symlink-resolved using the same helpers used for `pinnedDirectories`.

#### Scenario: Add folder to workspace
- **WHEN** a browser sends `{ type: "add_folder_to_workspace", id, path: "/home/user/repo-a" }` and the path is not in any workspace
- **THEN** the server SHALL append the normalized, symlink-resolved path to the target workspace's `folders[]`, persist, and broadcast `workspaces_updated`

#### Scenario: Add folder already in another workspace
- **WHEN** a folder is in workspace A and a browser sends `add_folder_to_workspace` with workspace B's id and that folder
- **THEN** the server SHALL remove the folder from A's `folders[]`, append it to B's `folders[]`, persist, and broadcast `workspaces_updated`

#### Scenario: Add folder already in the target workspace
- **WHEN** a folder is already in the target workspace's `folders[]`
- **THEN** the server SHALL leave state unchanged (idempotent, no duplicate entries) and SHALL NOT broadcast

#### Scenario: Add folder with pin state untouched
- **WHEN** a folder is in `pinnedDirectories` and is added to a workspace
- **THEN** the folder SHALL remain in `pinnedDirectories` unchanged; the two lists SHALL coexist

#### Scenario: Add folder normalizes path
- **WHEN** a browser sends `add_folder_to_workspace` with a path that contains symlinks or non-canonical separators
- **THEN** the stored entry in `folders[]` SHALL be the normalized + symlink-resolved canonical form

### Requirement: Folder removal from a workspace
The server SHALL remove a folder from a workspace's `folders[]` without touching `pinnedDirectories` or any other state.

#### Scenario: Remove folder that is workspace-only (not pinned)
- **WHEN** a folder is in workspace W's `folders[]` and not in `pinnedDirectories`, and a browser sends `{ type: "remove_folder_from_workspace", id: W.id, path }`
- **THEN** the folder SHALL be removed from `folders[]`, `pinnedDirectories` SHALL be unchanged, and `workspaces_updated` SHALL be broadcast

#### Scenario: Remove folder that is also pinned
- **WHEN** a folder is in workspace W's `folders[]` and also in `pinnedDirectories`, and a browser sends `remove_folder_from_workspace`
- **THEN** the folder SHALL be removed only from `folders[]`; `pinnedDirectories` SHALL still contain it

#### Scenario: Remove folder not in workspace
- **WHEN** a browser sends `remove_folder_from_workspace` for a path not in the target workspace
- **THEN** the server SHALL leave state unchanged and SHALL NOT broadcast

### Requirement: Folder ordering within a workspace
The server SHALL store folder order in `workspaces[i].folders` as the single source of truth for intra-workspace display order. Pin order SHALL have no effect inside a workspace.

#### Scenario: Reorder folders within a workspace
- **WHEN** a browser sends `{ type: "reorder_workspace_folders", id, paths: ["/b", "/a", "/c"] }` and the supplied set matches the workspace's current folders
- **THEN** the workspace's `folders[]` SHALL be replaced with the provided order, persisted, and broadcast

#### Scenario: Reorder rejects mismatched set
- **WHEN** the supplied `paths` array does not equal the workspace's current folder set
- **THEN** the server SHALL leave state unchanged and SHALL NOT broadcast

#### Scenario: Pin order does not affect intra-workspace order
- **WHEN** a workspace contains folders `["/x", "/y"]` in that order and `pinnedDirectories` lists `["/y", "/x"]`
- **THEN** the workspace SHALL render folders in `["/x", "/y"]` order

### Requirement: Workspace reordering
The server SHALL store workspace order as the order of the `workspaces[]` array. Browsers SHALL reorder by sending the desired full ordering.

#### Scenario: Reorder workspaces
- **WHEN** a browser sends `{ type: "reorder_workspaces", ids: [...] }` matching the current set
- **THEN** the server SHALL replace the array order accordingly, persist, and broadcast

#### Scenario: Reorder rejects mismatched set
- **WHEN** the supplied `ids` array does not equal the current workspace id set
- **THEN** the server SHALL leave state unchanged and SHALL NOT broadcast

### Requirement: WebSocket protocol for workspaces
The server SHALL accept the workspace mutation messages and SHALL emit a single broadcast type `workspaces_updated` carrying the full workspace list after every mutation.

#### Scenario: Browser receives initial workspaces on subscribe
- **WHEN** a browser establishes a WebSocket connection
- **THEN** the server SHALL include a `workspaces_updated` message with the current full list as part of the initial state payload

#### Scenario: Broadcast format
- **WHEN** the server broadcasts after any workspace mutation
- **THEN** the message SHALL be `{ type: "workspaces_updated", workspaces: Workspace[] }` containing the complete current list in array order

#### Scenario: Unknown workspace message types are ignored
- **WHEN** a browser sends a message whose `type` is not a recognized workspace verb
- **THEN** the server SHALL ignore the message at the workspace handler boundary (other handlers may still process it)

### Requirement: Single-membership invariant
The system SHALL guarantee that no folder path appears in more than one workspace's `folders[]` at any time, including after concurrent mutations from multiple browsers.

#### Scenario: Concurrent add to two workspaces
- **WHEN** two browsers simultaneously add the same folder to two different workspaces
- **THEN** after both writes are processed, the folder SHALL appear in exactly one workspace's `folders[]` (last-writer-wins) and SHALL NOT appear in the other

### Requirement: Client workspace-tier reorder affordance
The web client SHALL let the user reorder the workspace tier via drag-and-drop.
Dragging a workspace header to a new position among the other workspaces SHALL
emit a single `reorder_workspaces` message carrying the full ordered list of
workspace ids. The client SHALL NOT apply an optimistic local reorder; it SHALL
render the order from the server's `workspaces_updated` broadcast.

#### Scenario: Drag a workspace to a new position
- **WHEN** the user drags workspace W from index 0 and drops it at index 2 among three workspaces
- **THEN** the client SHALL send `{ type: "reorder_workspaces", ids: [...] }` with the new full ordering and SHALL re-render in the order received from the subsequent `workspaces_updated` broadcast

#### Scenario: Drop in the same position
- **WHEN** the user begins dragging a workspace header but drops it on itself or its original slot
- **THEN** the client SHALL NOT send any `reorder_workspaces` message

#### Scenario: Cross-type drag is rejected
- **WHEN** the user drags a workspace header over a non-workspace droppable (a pinned folder group or a session card)
- **THEN** the client SHALL treat the drag as a no-op and SHALL NOT emit any reorder message

### Requirement: Client intra-workspace folder reorder affordance
The web client SHALL let the user reorder the folders inside a single workspace
container via drag-and-drop. Dragging a folder within its workspace SHALL emit a
single `reorder_workspace_folders` message carrying that workspace's id and the
full ordered list of its folder paths. A folder SHALL NOT be draggable out of
its workspace into another workspace or into the top-level area (cross-container
drag remains out of scope). The client SHALL render the order from the server's
`workspaces_updated` broadcast.

#### Scenario: Drag a folder within its workspace
- **WHEN** the user drags folder `/a` below folder `/b` inside the same workspace
- **THEN** the client SHALL send `{ type: "reorder_workspace_folders", id, paths: [...] }` with that workspace's id and the new full folder ordering, and SHALL re-render in the order received from the subsequent `workspaces_updated` broadcast

#### Scenario: Cross-container folder drag is rejected
- **WHEN** the user drags a folder from workspace A and drops it over a folder in workspace B or over the top-level area
- **THEN** the client SHALL treat the drag as a no-op and SHALL NOT emit any reorder message

#### Scenario: Reorder does not toggle collapse
- **WHEN** the user completes a drag of a folder header inside a workspace
- **THEN** the folder's collapsed state SHALL be unchanged by the drag

### Requirement: Add-to-workspace affordance

The add-to-workspace gesture SHALL be presented as a labelled pill — an `mdiViewGridPlus` glyph plus the visible
text label "Workspace" — rendered inside the row's action cluster and padded to a ≥44 px touch target at mobile
breakpoints. It SHALL carry an accessible name conveying the full verb (e.g. "Add to workspace") via
`aria-label` and `title`, so the visible noun never becomes the sole cue, and SHALL expose `aria-haspopup` with
`aria-expanded` reflecting popover state. The prior 10px `+ws` text token, positioned in its own
absolutely-placed layer outside the cluster, SHALL be removed.

NOTE — presentation reconciled with `add-to-workspace-affordance` (archived
`2026-08-04-enlarge-add-to-workspace-button`), which landed on `develop` while this change was unmerged and
promoted the labelled pill to a main spec. This change's original compact `mdiFolderPlus` + `mdiMenuDown`
disclosure-caret icon button is SUPERSEDED; the a11y contract and the scope-keyed popover state below are not.

The affordance SHALL be present in BOTH surfaces where it exists today: the sidebar folder-group header and the
session card header (where it targets the session's cwd).

#### Scenario: Folder row renders the labelled pill, not the text token

- **WHEN** a top-level folder group header renders and at least one workspace exists or workspace creation is available
- **THEN** a pill carrying a glyph, the visible label "Workspace", and an accessible name for adding to a workspace SHALL render inside the header's icon cluster
- **AND** no element with the literal text `+ws` SHALL render

#### Scenario: Session card renders the same affordance

- **WHEN** a session card header renders
- **THEN** the same labelled pill, with an accessible name for adding the session's cwd to a workspace, SHALL render in the card's header cluster

#### Scenario: Disclosure state is exposed

- **WHEN** the user activates the add-to-workspace button
- **THEN** `aria-expanded` SHALL become `true` while the popover is open
- **AND** SHALL return to `false` when the popover closes via outside click or Escape

### Requirement: Add-to-workspace popover offers no pin destination

The add-to-workspace popover SHALL list existing workspaces, a `+ New workspace…` entry, and — when the folder
already belongs to a workspace — a remove-from-workspace entry. It SHALL NOT offer a "Pin to dashboard" entry:
a folder rendered in the sidebar is already visible, so pinning is not a destination the popover can meaningfully
offer. When no workspaces exist the popover SHALL state that plainly rather than rendering an empty list.

#### Scenario: No pin entry in the popover

- **WHEN** the add-to-workspace popover renders
- **THEN** it SHALL NOT contain a "Pin to dashboard" menu item

#### Scenario: Popover with no workspaces

- **WHEN** the popover renders and zero workspaces exist
- **THEN** a "no workspaces yet" statement SHALL render
- **AND** a `+ New workspace…` entry SHALL render

#### Scenario: Popover for a folder already in a workspace

- **GIVEN** the folder belongs to workspace `Frontend`
- **WHEN** the popover renders
- **THEN** `Frontend` SHALL be indicated as the current workspace and SHALL NOT be selectable as a new target
- **AND** a remove-from-workspace entry SHALL render

