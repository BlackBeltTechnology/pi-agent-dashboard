## MODIFIED Requirements

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

#### Scenario: Eject zone renders alongside pinned directories
- **GIVEN** at least one pinned directory is visible
- **WHEN** a workspace folder is dragged
- **THEN** the dedicated pinned-tier drop area SHALL render
- **AND** dropping the folder on it SHALL send `move_folder_to_workspace` with `toWorkspaceId: null`
- **AND** dropping the folder on a pinned directory SHALL still send the same message

#### Scenario: Eject zone renders when a filter hides every pinned directory
- **GIVEN** pinned directories exist but a sidebar filter hides all of them
- **WHEN** a workspace folder is dragged
- **THEN** the dedicated pinned-tier drop area SHALL render

#### Scenario: Eject zone is absent for other drags and after the drag ends
- **WHEN** a session, a workspace, or a pinned directory is dragged
- **THEN** the dedicated pinned-tier drop area SHALL NOT render
- **AND** after a workspace-folder drag is dropped, cancelled or aborted with Escape, the area SHALL no longer render

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
