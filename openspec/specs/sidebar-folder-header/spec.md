# Sidebar Folder Header

## Purpose

Pinned-folder header in the sidebar uses a two-column gutter + content layout. Left gutter holds the chevron toggle and acts as the drag handle (no overlay icon). Content column hosts the folder name, branch, action bar, plugin slot, and OpenSpec section without redundant left indents. Chevron OR the folder-name row toggles collapse; clicking the branch, pin, readme, or action buttons does not (those stop click propagation).
## Requirements
### Requirement: Folder header uses gutter + content two-column layout

The folder header SHALL use a two-column layout:

1. **Left gutter** (fixed narrow column): the collapse chevron at the top, with the surrounding gutter area acting as the drag handle.
2. **Content column** (`flex-1 min-w-0`): folder icon + name + count on the first row, with the folder actions menu trigger as the row's single trailing control; branch (`GroupGitInfo`) on the second row, which carries git facts only; the tier-0 call-to-action banner below the branch row when one is warranted; `SidebarFolderSectionSlot` and (when initialized) `FolderOpenSpecSection` below.

The first row SHALL NOT carry a pin button — pinning is an item in the folder actions menu.

`FolderActionBar` no longer exists. Its initialization controls render in the tier-0 banner and its cleanup action is an item in the folder actions menu, so the git row shares space with nothing and stays facts-only.

#### Scenario: First row carries the menu trigger, not a pin button

- **WHEN** an expanded folder header renders
- **THEN** the first content row SHALL carry the folder icon, name, count, and the folder actions menu trigger
- **AND** it SHALL NOT carry a pin button

#### Scenario: The git row carries no action controls

- **WHEN** an expanded folder header renders for a directory with a pending initialization
- **THEN** the git row SHALL carry only the branch and dirty-state affordances
- **AND** the initialization control SHALL render in the banner below it

#### Scenario: A quiet folder renders no banner row

- **WHEN** an expanded folder header renders for a configured folder with no pending init and no blocking state
- **THEN** no banner SHALL render between the git row and the slot pills

#### Scenario: Gutter holds the chevron and the drag handle

- **WHEN** a folder header renders
- **THEN** the collapse chevron SHALL live in the left gutter
- **AND** the surrounding gutter area SHALL act as the drag handle

#### Scenario: Branch row sits in the content column with no extra indent

- **WHEN** a pinned folder header is rendered with a known git branch
- **THEN** the branch row SHALL NOT carry an `ml-5` or `ml-3` class
- **AND** the branch text SHALL render at the start of the content column

### Requirement: Chevron toggles collapse; surrounding gutter area is the drag handle

The chevron in the left gutter SHALL toggle the folder's collapsed state.

The folder-name row SHALL navigate to the directory home page rather than toggle collapse.

Interactive controls within that row (the folder actions menu trigger), on the git row (branch `GroupGitInfo`), and in the tier-0 banner (its call-to-action) MUST stop click propagation, or live outside the clickable row, so they perform their own action and MUST NOT collapse the folder or trigger row navigation.

#### Scenario: Chevron toggles collapse

- **WHEN** the user activates the chevron in the left gutter
- **THEN** the folder's collapsed state SHALL toggle

#### Scenario: Child controls neither collapse nor navigate

- **GIVEN** an expanded folder header
- **WHEN** the user activates the folder actions menu trigger, the branch control, or the banner's action
- **THEN** that control's own action SHALL fire
- **AND** the folder SHALL NOT collapse
- **AND** the client SHALL NOT navigate to the directory home page

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

The status capsule SHALL sit between the folder-name region and the trailing cluster, SHALL itself be
non-shrinking (`flex: none`) with non-wrapping content, and SHALL NOT wrap to a second row. Like the cluster, it
sheds no content under width pressure: the horizontal squeeze is absorbed entirely by the shrinkable folder-name
region, which is the only shrinkable child of the row. This preserves the behaviour of the pill and rollup it
replaces.

Name truncation SHALL be prioritised so the folder's own name survives longest: the leading parent-path segment
SHALL shrink first and MAY collapse entirely, while the final path segment (the folder name) SHALL retain a
legible minimum before it ellipses.

#### Scenario: The cluster control remains visible when the sidebar is narrow

- **GIVEN** a folder header rendering the trailing cluster
- **WHEN** the sidebar is narrowed to 220 px
- **THEN** the folder actions trigger SHALL remain rendered on one line in the top-right
- **AND** the cluster SHALL NOT wrap to a second row

#### Scenario: Capsule survives narrowing intact; the name absorbs the squeeze

- **GIVEN** a folder header rendering a capsule with needs-you, error, working and idle segments
- **WHEN** the sidebar is narrowed to 220 px
- **THEN** every rendered segment SHALL remain rendered
- **AND** the capsule SHALL NOT wrap to a second row
- **AND** the folder-name region SHALL absorb the reduction by truncating

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

