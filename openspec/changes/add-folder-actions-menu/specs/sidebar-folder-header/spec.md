## MODIFIED Requirements

### Requirement: Folder header uses gutter + content two-column layout

The folder header SHALL use a two-column layout:

1. **Left gutter** (fixed narrow column): the collapse chevron at the top, with the surrounding gutter area acting as the drag handle.
2. **Content column** (`flex-1 min-w-0`): folder icon + name + count on the first row, with the folder actions menu trigger as the row's single trailing control; branch (`GroupGitInfo`) on the second row, sharing that row with `FolderActionBar` when the bar has controls to render; `SidebarFolderSectionSlot` and (when initialized) `FolderOpenSpecSection` below.

The first row SHALL NOT carry a pin button — pinning is an item in the folder actions menu.

`FolderActionBar` SHALL render only when it holds at least one control. With the Directory
Settings cog moved into the menu, a configured folder with no pending init and no broken
sessions has none, and the bar SHALL be absent rather than render empty.

#### Scenario: First row carries the menu trigger, not a pin button

- **WHEN** an expanded folder header renders
- **THEN** the first content row SHALL carry the folder icon, name, count, and the folder actions menu trigger
- **AND** it SHALL NOT carry a pin button

#### Scenario: Action bar shares the git row and hides when empty

- **WHEN** an expanded folder header renders while `FolderActionBar` holds at least one control
- **THEN** the git info and the action bar SHALL render on the same row
- **WHEN** the same header renders for a configured folder with no pending init and no broken sessions
- **THEN** `FolderActionBar` SHALL NOT render

#### Scenario: Gutter holds the chevron and the drag handle

- **WHEN** a folder header renders
- **THEN** the collapse chevron SHALL live in the left gutter
- **AND** the surrounding gutter area SHALL act as the drag handle

### Requirement: Chevron toggles collapse; surrounding gutter area is the drag handle

The chevron in the left gutter SHALL toggle the folder's collapsed state.

The folder-name row SHALL navigate to the directory home page rather than toggle collapse.

Interactive controls within that row (the folder actions menu trigger) and on the git row (branch `GroupGitInfo`, and `FolderActionBar` when present) MUST stop click propagation, or live outside the clickable row, so they perform their own action and MUST NOT collapse the folder or trigger row navigation.

#### Scenario: Chevron toggles collapse

- **WHEN** the user activates the chevron in the left gutter
- **THEN** the folder's collapsed state SHALL toggle

#### Scenario: Child controls neither collapse nor navigate

- **GIVEN** an expanded folder header
- **WHEN** the user activates the folder actions menu trigger, the branch control, or a control on `FolderActionBar`
- **THEN** that control's own action SHALL fire
- **AND** the folder SHALL NOT collapse
- **AND** the client SHALL NOT navigate to the directory home page

### Requirement: Header icon cluster stays in the top-right at any width

The folder header's trailing action cluster SHALL remain on a single line anchored to the top-right of the header
at every sidebar width, and SHALL NOT wrap to a second row or be pushed out of the card. The cluster SHALL be
non-shrinking (`flex: none`) with non-wrapping content (`white-space: nowrap`); the horizontal squeeze SHALL be
absorbed by the folder-name region, which SHALL be shrinkable (`min-width: 0`) and clipped with an ellipsis.

Name truncation SHALL be prioritised so the folder's own name survives longest: the leading parent-path segment
SHALL shrink first and MAY collapse entirely, while the final path segment (the folder name) SHALL retain a
legible minimum before it ellipses.

#### Scenario: The cluster control remains visible when the sidebar is narrow

- **GIVEN** a folder header rendering the trailing cluster
- **WHEN** the sidebar is narrowed to 220 px
- **THEN** the folder actions trigger SHALL remain rendered on one line in the top-right
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
