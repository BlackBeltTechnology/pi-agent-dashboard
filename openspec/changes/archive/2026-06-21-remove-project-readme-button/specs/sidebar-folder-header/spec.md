## MODIFIED Requirements

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
