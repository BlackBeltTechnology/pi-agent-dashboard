## MODIFIED Requirements

### Requirement: Changed Files integrated into the split editor pane

The client SHALL surface changed files inside the split editor pane rather than as a full-screen takeover: a Changes section pinned atop the pane's project-tree rail, with each file's diff opened as a per-file `diff`-viewer tab (a new `ViewerKind` `diff`). A `SplitWorkspaceContext` helper `openChanges()` SHALL open the split and reveal the Changes section. The chat SHALL remain mounted in the adjacent pane.

The Changes section SHALL mount **collapsed**: on initial render only its `▸ Changes (N)` header row SHALL be shown, and the roll-up sub-header and file tree SHALL be hidden until the user expands the section. Collapse state SHALL NOT persist across sessions — every mount SHALL start collapsed. `openChanges()` SHALL still reveal (expand) the section, so activating a changed-file link from the chat transcript SHALL open the section regardless of its collapsed default.

#### Scenario: Changes section is collapsed by default
- **WHEN** the editor pane rail mounts for a session that has changes
- **THEN** only the `▸ Changes (N)` header row SHALL be rendered
- **AND** the roll-up sub-header and the file tree SHALL NOT be rendered until the user expands the section

#### Scenario: Expanding reveals the compact tree unchanged
- **WHEN** the user clicks the collapsed `▸ Changes (N)` header
- **THEN** the section SHALL expand to the roll-up sub-header plus the compact `DiffFileTree` (single-child directory chains merged), with no change to tree rendering

#### Scenario: openChanges reveals the collapsed section
- **WHEN** `openChanges()` fires (e.g. the user activates a changed-file link in the chat transcript) while the section is collapsed
- **THEN** the section SHALL expand and scroll into view
- **AND** the referenced file's diff SHALL open as a `diff`-viewer tab

#### Scenario: Open a specific file's diff
- **WHEN** the user activates a Changes-section row OR the open affordance on a per-turn block file row
- **THEN** a `diff`-viewer tab (sibling to normal file tabs) SHALL open
- **AND** the Changes section SHALL mark that file as the active selection
