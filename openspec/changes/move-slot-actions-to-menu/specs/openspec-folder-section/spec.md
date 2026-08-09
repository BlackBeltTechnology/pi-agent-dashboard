## MODIFIED Requirements

### Requirement: Folder group header shows OpenSpec section

Each folder group in the session list SHALL render a `FolderOpenSpecSection` component in the folder header, below git info and above editor/spawn buttons, when OpenSpec data for that directory is either `initialized: true` or `pending: true`.

The section SHALL render no action controls of its own. Its refresh, specs-browser and archive affordances are items in the folder actions menu; the section itself is state-only.

#### Scenario: Directory with initialized OpenSpec
- **WHEN** a folder group is rendered for cwd `/project/foo` and OpenSpec data for that cwd has `initialized: true`
- **THEN** a `FolderOpenSpecSection` SHALL be rendered in the folder header showing the standard collapsed header
- **AND** it SHALL render no refresh, specs or archive control

#### Scenario: Directory with openspec dir but slow poll pending
- **WHEN** a folder group is rendered for cwd `/project/foo` and OpenSpec data has `initialized: false` and `pending: true`
- **THEN** a `FolderOpenSpecSection` SHALL be rendered in the folder header showing the grey loading spinner (no buttons, no chevron)

#### Scenario: Directory without OpenSpec
- **WHEN** a folder group is rendered for cwd `/project/foo` and OpenSpec data has `initialized: false` and `pending: false` (or is not available)
- **THEN** no OpenSpec section SHALL be rendered in the folder header

#### Scenario: Pinned directory with no sessions
- **WHEN** a pinned directory has OpenSpec data but no active sessions
- **THEN** the `FolderOpenSpecSection` SHALL still be rendered showing its change list
- **AND** its folder-level actions SHALL be reachable from the folder actions menu

### Requirement: Collapsible change list in folder section

The folder OpenSpec section SHALL render as a single-line entry that navigates to the full-page OpenSpec board instead of expanding inline. The entry SHALL show the OpenSpec label and the change count, and SHALL act as a button that opens the board route `/folder/:encodedCwd/openspec`. It SHALL NOT render a Refresh control — refreshing is an item in the folder actions menu. The inline collapsible change tree, group pills, and in-section search SHALL be removed (their functionality moves to the board).

#### Scenario: Single-line navigation entry
- **WHEN** the folder OpenSpec section is rendered for a cwd with N changes
- **THEN** it SHALL show `OpenSpec (N) →` and SHALL NOT render an inline change tree
- **AND** it SHALL NOT render a Refresh control

#### Scenario: Click opens the board
- **WHEN** the user clicks the folder OpenSpec entry
- **THEN** the app SHALL navigate to `/folder/<encodedCwd>/openspec`

#### Scenario: No inline expansion
- **WHEN** the user interacts with the folder OpenSpec entry
- **THEN** there SHALL be no inline expand/collapse of a change list in the folder card

## REMOVED Requirements

### Requirement: Folder-level Refresh button

**Reason**: One of six `mdiRefresh` controls on a single card. Per-slot refetch is data plumbing leaking into the UI; nobody wants to refresh only OpenSpec.

**Migration**: Folded into the single `MAINTENANCE` refresh item — see `folder-actions-menu` → "The three plain slot refreshes collapse to one". Refreshing that item refetches the OpenSpec section.

### Requirement: Folder-level Specs button opens specs browser

**Reason**: Moves rather than dies. Deleting it (the board it duplicates is one pill-click away) was rejected — it is used often enough to keep a shortcut, just not a permanent button on the card.

**Migration**: Rendered as a slot-qualified item in the menu's `OPEN` group — see `folder-actions-menu` → "Slot actions are menu items in a fixed verb taxonomy" and "Ambiguous item labels are slot-qualified". Destination and behaviour unchanged.

### Requirement: Archive button in folder OpenSpec section

**Reason**: Same as above — a permanent card button for a navigation shortcut, and one of the eight glyph collisions counted across the rendered card.

**Migration**: Rendered as "OpenSpec archive" in the menu's `OPEN` group. Destination and behaviour unchanged.
