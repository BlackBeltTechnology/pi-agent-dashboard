# Sidebar Folder Header

## Purpose

Pinned-folder header in the sidebar uses a two-column gutter + content layout. Left gutter holds the chevron toggle and acts as the drag handle (no overlay icon). Content column hosts the folder name, branch, action bar, plugin slot, and OpenSpec section without redundant left indents. Chevron OR the folder-name row toggles collapse; clicking the branch, pin, readme, or action buttons does not (those stop click propagation).
## Requirements
### Requirement: Folder header uses gutter + content two-column layout
The pinned-folder header in `SessionList.tsx` SHALL render as a two-column flex row:

1. **Left gutter** (`FolderDragGutter`): a `flex flex-col items-center flex-shrink-0 w-3 pt-0.5` column containing the chevron toggle button at the top, followed by an empty `flex-1` spacer that fills the rest of the header height.
2. **Content column** (`flex-1 min-w-0`): folder icon + name + count + pin button on the first row; branch (`GroupGitInfo`) on the second row; `FolderActionBar` on the third row; `SidebarFolderSectionSlot` and (when initialized) `FolderOpenSpecSection` below.

The previous `ml-5` and `ml-3` indents in `SessionList.tsx` (branch row, action-bar row, OpenSpec wrapper) and in `FolderOpenSpecSection.tsx` (internal change rows, sub-rows) SHALL be removed — the gutter column now provides the single, consistent left offset.

The outer pinned-group container padding SHALL be tightened to `p-1.5` (was `p-2`) and the inner header padding to `px-1 py-1` (was `px-2 py-1.5`).

#### Scenario: Folder header has gutter column followed by content column
- **WHEN** a pinned folder header is rendered
- **THEN** the rendered DOM SHALL contain a flex row with two children: a `flex-shrink-0 w-3` gutter `<div>` first, then a `flex-1 min-w-0` content `<div>` second

#### Scenario: Branch row sits in the content column with no extra indent
- **WHEN** a pinned folder header is rendered with a known git branch
- **THEN** the branch row SHALL NOT carry an `ml-5` or `ml-3` class
- **AND** the branch text SHALL render at the start of the content column

### Requirement: Chevron toggles collapse; surrounding gutter area is the drag handle
The folder chevron SHALL be a `<button>` inside the gutter that handles `onClick` to invoke the toggle-collapse callback and stops `pointerDown` propagation so the surrounding drag listener does not compete on click.

The gutter `<div>` itself SHALL carry the dnd-kit handle props supplied by `SortablePinnedGroup` via the `FolderDragHandleCtx` context (consumed by `useFolderDragHandle()`). When context is non-null, the gutter SHALL carry `cursor-grab active:cursor-grabbing` and `data-testid="drag-handle-pinned"`. The empty `flex-1` spacer below the chevron is the visible drag area.

The folder-name row (the first content row: folder icon + name + session count) SHALL carry `onClick={() => handleToggleCollapse(...)}` and `cursor-pointer` so clicking the directory name/path toggles collapse, mirroring the chevron. Interactive controls within that row (the pin/unpin toggle) and on subsequent rows (branch `GroupGitInfo`, `FolderActionBar`) MUST stop click propagation (or live outside the clickable row) so they perform their own action and MUST NOT collapse the folder.

#### Scenario: Chevron click toggles collapse
- **WHEN** the user clicks the chevron button (`data-testid="folder-toggle-btn"`)
- **THEN** the `onToggle` callback SHALL fire exactly once
- **AND** the surrounding gutter's drag listener SHALL NOT initiate a drag (pointerDown propagation stopped)

### Requirement: SortablePinnedGroup exposes drag handle via context, no overlay icon
`SortablePinnedGroup` SHALL NOT render any visible drag-handle icon overlay. It SHALL expose its dnd-kit `attributes` and `listeners` to descendants via a `FolderDragHandleCtx` React context, with a hook `useFolderDragHandle()` for consumption.

#### Scenario: No legacy drag-handle icon overlay
- **WHEN** a SortablePinnedGroup is rendered
- **THEN** the rendered DOM SHALL NOT contain an absolute-positioned span with the `mdiDragHorizontalVariant` icon path

#### Scenario: Context provides handle props
- **WHEN** a descendant calls `useFolderDragHandle()` within a SortablePinnedGroup
- **THEN** it SHALL return an object combining the dnd-kit `attributes` and `listeners`

### Requirement: Header icon cluster stays in the top-right at any width

The folder header's trailing action cluster SHALL remain on a single line anchored to the top-right of the header
at every sidebar width, and SHALL NOT wrap to a second row or be pushed out of the card. The cluster SHALL be
non-shrinking (`flex: none`) with non-wrapping content (`white-space: nowrap`); the horizontal squeeze SHALL be
absorbed by the folder-name region, which SHALL be shrinkable (`min-width: 0`) and clipped with an ellipsis.

Name truncation SHALL be prioritised so the folder's own name survives longest: the leading parent-path segment
SHALL shrink first and MAY collapse entirely, while the final path segment (the folder name) SHALL retain a
legible minimum before it ellipses.

#### Scenario: All cluster icons remain visible when the sidebar is narrow

- **GIVEN** a folder header rendering the full cluster (urgency sort, add-to-workspace, open-home, pin)
- **WHEN** the sidebar is narrowed to 220 px
- **THEN** every cluster button SHALL remain rendered on one line in the top-right
- **AND** the cluster SHALL NOT wrap to a second row

#### Scenario: Parent path collapses before the folder name

- **GIVEN** a folder whose path is `/home/user/Documents/general`
- **WHEN** available width is insufficient for the whole path
- **THEN** the `/home/user/Documents/` parent portion SHALL be truncated or collapsed first
- **AND** the `general` segment SHALL remain at least partially legible

#### Scenario: Long folder name does not displace the cluster

- **GIVEN** a folder whose final path segment is very long
- **WHEN** the header renders
- **THEN** the name SHALL be clipped with an ellipsis
- **AND** the cluster SHALL stay fully within the header's right edge

