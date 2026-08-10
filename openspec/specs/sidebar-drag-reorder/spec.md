# sidebar-drag-reorder Specification

## Purpose
TBD - created by archiving change workspace-directory-drag-reorder. Update Purpose after archive.
## Requirements
### Requirement: Drag-to-reorder workspaces
Users SHALL be able to reorder workspace containers in the sidebar by dragging a workspace by its header drag handle. On drop, the client SHALL send `{ type: "reorder_workspaces", ids }` with the full new ordering and rely on the server's `workspaces_updated` broadcast to reflect the change.

#### Scenario: Drag a workspace to a new position
- **WHEN** a user drags workspace A from position 1 and drops it onto workspace C at position 3
- **THEN** the client SHALL send `reorder_workspaces` with the ids reordered to place A after C
- **AND** the sidebar SHALL reflect the new order once `workspaces_updated` arrives

#### Scenario: Dropping a workspace on itself is a no-op
- **WHEN** a workspace drag begins and ends on the same workspace
- **THEN** the client SHALL NOT send `reorder_workspaces`

### Requirement: Drag-to-reorder folders within a workspace
Users SHALL be able to reorder folders inside a workspace by dragging. On drop
within the same workspace, the client SHALL send
`{ type: "reorder_workspace_folders", id, paths }` with the workspace id and the
full new folder ordering. A folder dropped on a target belonging to a
*different* workspace SHALL be handled as a membership move (see
`Drag folders across workspace boundaries`), not as a reorder.

#### Scenario: Reorder folders inside one workspace
- **WHEN** a user drags a folder within workspace W from position 1 to position 2
- **THEN** the client SHALL send `reorder_workspace_folders` with W's id and the swapped `paths`

### Requirement: Workspace auto-collapse during drag
While a workspace is being dragged, that workspace SHALL render collapsed regardless of its persisted collapsed state, and SHALL return to its prior rendered state when the drag ends or is cancelled. Only the dragged workspace SHALL be affected. This temporary collapse SHALL be client-local and visual only and SHALL NOT emit `set_workspace_collapsed` or alter the server-persisted collapsed preference.

#### Scenario: Expanded workspace collapses during its own drag
- **WHEN** a user begins dragging an expanded workspace
- **THEN** that workspace SHALL render collapsed for the duration of the drag
- **AND** other workspaces SHALL keep their current expanded/collapsed rendering

#### Scenario: Prior state restored on drop
- **WHEN** the drag of a previously-expanded workspace ends or is cancelled
- **THEN** that workspace SHALL render expanded again

#### Scenario: Drag-collapse never persists
- **WHEN** a workspace is dragged and dropped
- **THEN** the client SHALL NOT send `set_workspace_collapsed` as part of the drag interaction

### Requirement: Drop indicator for sidebar drags
While dragging within the sidebar, the hovered drop target SHALL display a visible drop indicator (a dashed outline with a faint accent background). The indicator SHALL apply to workspace, intra-workspace folder, and pinned-directory-group drag targets. The indicator SHALL NOT apply to individual session cards, which retain slide-only feedback.

#### Scenario: Indicator shows on a hovered workspace target
- **WHEN** a workspace is dragged over another workspace slot
- **THEN** the hovered workspace slot SHALL render the drop indicator

#### Scenario: Indicator shows on a hovered folder and pinned-group target
- **WHEN** a folder is dragged over another folder within the same workspace, or a pinned group is dragged over another pinned group
- **THEN** the hovered target slot SHALL render the drop indicator

#### Scenario: No indicator on session cards
- **WHEN** a session card is dragged within its folder
- **THEN** no dashed-slot drop indicator SHALL render on session targets

### Requirement: Type-aware drag collision detection
The sidebar drag-and-drop SHALL constrain candidate drop targets using a
compatibility matrix over the active draggable's `type`, so nested sortable
contexts do not capture a drag intended for an outer target. `session` drags
SHALL only resolve to `session` targets, and `workspace` drags SHALL only
resolve to `workspace` targets. `workspace-folder` drags SHALL resolve to
`workspace-folder`, `workspace-header`, `pinned-group`, and `pinned-tier`
targets. `pinned-group` drags SHALL resolve to `workspace-folder`,
`workspace-header`, and `pinned-group` targets, but NOT to `pinned-tier`.

#### Scenario: Workspace drag is not captured by inner folders
- **WHEN** a workspace is expanded (its folders visible) and the user drags that workspace over another workspace
- **THEN** the drop target SHALL resolve to a workspace, not an inner folder or session
- **AND** the workspace order SHALL update

#### Scenario: Folder drag is not captured by inner sessions
- **WHEN** a folder inside a workspace is expanded (its sessions visible) and the user drags that folder within the workspace
- **THEN** the drop target SHALL resolve to a folder, not an inner session

#### Scenario: Session drag never resolves to a workspace target
- **WHEN** a session card is dragged over a workspace header or a workspace folder
- **THEN** the drop target SHALL NOT resolve to a workspace or folder
- **AND** no membership message SHALL be sent

#### Scenario: Pinned-group reorder is not hijacked by the eject rule
- **WHEN** a pinned directory is dragged onto another pinned directory
- **THEN** the client SHALL send `reorder_pinned_dirs` as it does today
- **AND** SHALL NOT send `move_folder_to_workspace`

### Requirement: Drag folders across workspace boundaries
Users SHALL be able to change a directory's workspace membership by dragging.
On such a drop the client SHALL send exactly one message
`{ type: "move_folder_to_workspace", path, toWorkspaceId, index? }` and rely on
the server's `workspaces_updated` broadcast to reflect the change. The server
SHALL resolve `toWorkspaceId` BEFORE mutating any state, then detach `path` from
every workspace and either insert it into the target at `index` (appending when
`index` is omitted) or, when `toWorkspaceId` is `null`, pin the directory.
`index` SHALL be clamped to the target's bounds. Only directories that are
already draggable — pinned directories and workspace folders — participate;
unpinned directory rows are out of scope.

#### Scenario: Pinned directory dragged into a workspace header
- **WHEN** a user drags a pinned directory onto a workspace's header
- **THEN** the client SHALL send `move_folder_to_workspace` with that workspace's id and no `index`
- **AND** the directory SHALL appear as the last folder of that workspace

#### Scenario: Folder dragged into a positional slot
- **WHEN** a user drags a workspace folder onto the slot before folder 2 of a different expanded workspace
- **THEN** the client SHALL send `move_folder_to_workspace` with that workspace's id and `index` 1
- **AND** the directory SHALL appear at that position

#### Scenario: Pinned directory dragged into a positional slot
- **WHEN** a user drags a pinned directory onto the slot before folder 2 of an expanded workspace
- **THEN** the client SHALL send `move_folder_to_workspace` with that workspace's id and `index` 1

#### Scenario: Folder dragged between two workspaces
- **WHEN** a user drags a folder owned by workspace A onto workspace B
- **THEN** the client SHALL send a single `move_folder_to_workspace` with B's id
- **AND** the folder SHALL be a member of B only

#### Scenario: Folder dragged out of a workspace
- **WHEN** a user drags a workspace folder onto the pinned-directory tier
- **THEN** the client SHALL send `move_folder_to_workspace` with `toWorkspaceId: null`
- **AND** the directory SHALL be pinned so it remains visible even with no live sessions

#### Scenario: Eject affordance exists when the pinned tier is empty
- **WHEN** a workspace folder is dragged while no pinned directories are visible
- **THEN** a dedicated pinned-tier drop area SHALL render with a visible drop indicator and a minimum height of 64px, so it is a real cursor target rather than a hairline
- **AND** it SHALL NOT render while pinned directories are present, so there is only ever one eject target under the cursor

#### Scenario: Ejecting runs the same directory discovery as pinning
- **WHEN** a folder is ejected to the pinned tier
- **THEN** the server SHALL run the same directory-added side effects as an explicit pin, so historical on-disk sessions and OpenSpec data for that directory are discovered

#### Scenario: Drop on the folder's current position is a no-op
- **WHEN** a membership drag begins and ends on the folder's own slot
- **THEN** the client SHALL NOT send `move_folder_to_workspace`

#### Scenario: Drop on the folder's own workspace header is a no-op
- **WHEN** a user drops a folder onto the header of the workspace it already belongs to
- **THEN** the client SHALL NOT send `move_folder_to_workspace`
- **AND** the folder SHALL keep its current position rather than jumping to the end

#### Scenario: Unknown workspace id is rejected before any mutation
- **WHEN** the server receives `move_folder_to_workspace` naming a workspace that does not exist
- **THEN** the server SHALL NOT detach the folder from its current workspace
- **AND** SHALL NOT mutate state or broadcast `workspaces_updated`

#### Scenario: Rejected requests produce no side effects
- **WHEN** the server receives `move_folder_to_workspace` that it rejects — an unknown workspace id, a folder already in the target workspace, or an eject for a folder that belongs to no workspace
- **THEN** the server SHALL NOT pin the directory, SHALL NOT run directory-added side effects, and SHALL NOT broadcast

#### Scenario: Out-of-range index is clamped
- **WHEN** the server receives `move_folder_to_workspace` with a negative or oversized `index`
- **THEN** the insert position SHALL be clamped to the target workspace's bounds rather than splicing from the end

#### Scenario: Non-integer index is rejected
- **WHEN** the server receives `move_folder_to_workspace` with an `index` that is not a finite integer
- **THEN** the server SHALL reject the request rather than coercing it to a front insert

#### Scenario: Ejecting does not flash the folder out of the sidebar
- **WHEN** a workspace folder with no live sessions is ejected to the pinned tier
- **THEN** the directory SHALL remain continuously visible in the sidebar across the update
- **AND** SHALL NOT disappear or momentarily render in the unpinned tier

### Requirement: Spring-load collapsed workspaces during a drag
While a folder-like drag hovers a collapsed workspace header, that workspace
SHALL auto-expand after a short dwell so its positional drop slots become
reachable. Once expanded, the workspace SHALL REMAIN expanded for the rest of
the drag even as the hovered target changes, so that moving the pointer into the
newly revealed folders does not re-collapse it. The expansion SHALL be
client-local and visual only and SHALL NOT emit `set_workspace_collapsed`.

#### Scenario: Hovering a collapsed workspace expands it
- **WHEN** a user drags a directory over a collapsed workspace header and dwells there
- **THEN** that workspace SHALL render expanded for the remainder of the drag

#### Scenario: Entering the revealed folders does not re-collapse
- **WHEN** a spring-loaded workspace has expanded and the pointer moves onto one of its now-visible folders
- **THEN** that workspace SHALL stay expanded
- **AND** the drop target SHALL resolve to the hovered folder

#### Scenario: Spring-load never persists
- **WHEN** a spring-loaded workspace's drag ends or is cancelled
- **THEN** the client SHALL NOT have sent `set_workspace_collapsed`
- **AND** the workspace SHALL return to its persisted collapsed state

### Requirement: Folder collapse chevron doubles as a drag handle

The folder header's collapse chevron SHALL act as a drag-activation surface in
addition to toggling the folder's collapsed state. A pointer interaction on the
chevron that stays within the drag sensor's activation distance SHALL toggle
collapse; a pointer interaction that moves beyond the activation distance SHALL
begin a folder reorder drag using the folder header's existing drag listeners.
The chevron SHALL remain rendered in both the collapsed and expanded states so a
collapsed folder remains reorderable via its chevron. The left gutter column
below the chevron SHALL remain a drag-activation surface for the same folder.

#### Scenario: Clicking the chevron toggles collapse

- **WHEN** a user clicks the folder collapse chevron without moving past the
  activation distance
- **THEN** the folder's collapsed state SHALL toggle
- **AND** no reorder drag SHALL begin

#### Scenario: Dragging the chevron reorders the folder

- **WHEN** a user presses the folder collapse chevron and moves the pointer
  beyond the activation distance
- **THEN** a folder reorder drag SHALL begin
- **AND** the collapse state SHALL NOT toggle for that interaction

#### Scenario: Collapsed folder is reorderable via its chevron

- **WHEN** a folder is collapsed
- **THEN** its chevron SHALL still be rendered
- **AND** dragging that chevron SHALL reorder the collapsed folder

#### Scenario: Gutter column remains draggable

- **WHEN** a user drags the gutter column below the chevron
- **THEN** the folder reorder drag SHALL begin as before

