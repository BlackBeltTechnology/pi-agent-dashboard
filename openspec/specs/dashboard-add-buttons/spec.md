# dashboard-add-buttons Specification

## Purpose
Elevate dashboard- and workspace-scope add gestures to full-width line buttons. Replaces scattered low-discoverability affordances (header Pin+ chip, mid-list dashed New workspace button, mdiPin icon) with `+ Add Folder` / `+ New Workspace` buttons matching per-folder spawn styling. Reuses existing pin-dialog, create-workspace, add-folder-to-workspace handlers.
## Requirements
### Requirement: Elevated dashboard add-button pair
The sidebar SHALL render an elevated full-width stacked line-button pair as the first item in the scrollable session list, above any workspace tiers and pinned folder groups, using the same visual treatment as the per-folder spawn buttons (`FolderSpawnButtons`).

#### Scenario: Add Folder button
- **WHEN** the sidebar scroll list renders and an open-pin-dialog handler is available
- **THEN** a full-width `+ Add Folder` line button SHALL render with yellow accent styling
- **AND** clicking it SHALL invoke the existing open-pin-dialog handler that pins a top-level folder

#### Scenario: New Workspace button
- **WHEN** the sidebar scroll list renders and a create-workspace handler is available
- **THEN** a full-width `+ New Workspace` line button SHALL render below `+ Add Folder` with neutral accent styling
- **AND** clicking it SHALL open the new-workspace flow

#### Scenario: New Workspace gating preserved
- **WHEN** no create-workspace handler is provided
- **THEN** the `+ New Workspace` button SHALL NOT render
- **AND** the `+ Add Folder` button SHALL still render when its handler is available

#### Scenario: Positioned at top of scroll list
- **WHEN** the list contains workspace tiers and/or pinned folder groups
- **THEN** the add-button pair SHALL render before all of them and SHALL scroll with the list content

### Requirement: Workspace-scoped Add Folder button
Each expanded workspace container SHALL render a full-width `+ Add Folder` line button (yellow accent, same visual treatment as the dashboard-scope button) at the bottom of its body, below its folder list.

#### Scenario: Add Folder in workspace body
- **WHEN** a workspace tier is expanded and an add-folder-to-workspace handler is available
- **THEN** a full-width `+ Add Folder` line button SHALL render at the bottom of the workspace body
- **AND** clicking it SHALL open the folder picker scoped to that workspace (adds the chosen folder to that workspace)

#### Scenario: Collapsed workspace hides the button
- **WHEN** a workspace tier is collapsed
- **THEN** its `+ Add Folder` button SHALL NOT render

#### Scenario: Empty workspace still shows Add Folder
- **WHEN** an expanded workspace contains zero folders
- **THEN** the `+ Add Folder` button SHALL render so the workspace can be populated

### Requirement: Legacy add affordances removed
The standalone folder Pin+ chip in the header, the mid-list dashed `+ New workspace…` button, and the `mdiPin` add-folder icon button in the workspace header SHALL be removed; their actions are served solely by the elevated line buttons.

#### Scenario: No duplicate affordances
- **WHEN** the sidebar renders
- **THEN** the header SHALL NOT contain a folder Pin+ chip
- **AND** the scroll list SHALL NOT contain a separate dashed `+ New workspace…` button distinct from the elevated pair
- **AND** the workspace header SHALL NOT contain an `mdiPin` add-folder icon button

