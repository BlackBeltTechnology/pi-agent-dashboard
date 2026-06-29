## ADDED Requirements

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
