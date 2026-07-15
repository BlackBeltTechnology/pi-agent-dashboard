## MODIFIED Requirements

### Requirement: Changed Files integrated into the split editor pane

The client SHALL surface changed files inside the split editor pane rather than as a full-screen takeover. Changed files SHALL be marked **inline in the single workspace file tree** (`EditorFileTree`), NOT as a separate `DiffFileTree` section. A slim summary bar SHALL be pinned atop the rail showing `Changes (N)`, the aggregate `+X −Y` counts, a `this session only` toggle, and the `summed` badge for non-git sessions. Each file's diff SHALL open as a per-file `diff`-viewer tab (`ViewerKind` `diff`). A `SplitWorkspaceContext` helper `openChanges()` SHALL open the split and reveal the rail. The chat SHALL remain mounted in the adjacent pane.

A session-owned changed file that is currently visible in the tree SHALL show a status indicator (`+` added / `●` modified or tool-origin) and `+X −Y` count badges, and SHALL reveal a `diff` affordance on hover that opens the file's `diff`-viewer tab. Clicking the row's name SHALL open the **normal file viewer**, not the diff. A changed file with more than one recorded change event SHALL expand to its per-event `✏️/📝` rows.

A directory row whose subtree contains a session-owned changed file SHALL show a change dot, derived from the changed-file path list by prefix (no additional directory fetch), so changes inside collapsed directories remain discoverable. The tree SHALL NOT auto-expand to reveal changed files.

Working-tree changes this session did not make (`otherChanges`) SHALL render as a muted, collapsed group at the bottom of the rail's scroll region; the `this session only` toggle SHALL hide it. No `this session only` or view-mode state SHALL persist across sessions; tree expansion SHALL retain its existing persistence, and this change SHALL add no new persisted state.

#### Scenario: Changed files marked inline in the workspace tree
- **WHEN** the editor pane rail mounts for a session that has changes
- **THEN** the rail SHALL render a single workspace tree with a slim `Changes (N) · +X −Y · [this session only]` summary bar above it
- **AND** each visible session-owned changed file's row SHALL show a status indicator and `+X −Y` counts
- **AND** no standalone `DiffFileTree` changed-file list SHALL be rendered in the rail

#### Scenario: Folder dot marks changes in collapsed directories
- **WHEN** a session-owned changed file lives inside a directory that is not expanded
- **THEN** that directory's row SHALL show a change dot
- **AND** the tree SHALL NOT auto-expand to reveal the file

#### Scenario: Row click opens the file, diff chip opens the diff
- **WHEN** the user clicks a changed file row's name
- **THEN** the normal file viewer tab SHALL open
- **WHEN** the user activates the hover `diff` chip on that row
- **THEN** a `diff`-viewer tab SHALL open for that file

#### Scenario: Multi-event file expands to its change history
- **WHEN** a changed file has more than one recorded change event
- **THEN** its row SHALL offer an expander that reveals the per-event `✏️/📝` rows

#### Scenario: Other changes appear in the bottom group
- **WHEN** the session has working-tree changes it did not make (`otherChanges`)
- **THEN** they SHALL render in a muted, collapsed group at the bottom of the rail's scroll region
- **AND** enabling the `this session only` toggle SHALL hide that group

#### Scenario: openChanges reveals the rail
- **WHEN** `openChanges()` fires
- **THEN** the split SHALL open and the rail SHALL be revealed
- **AND** opening a specific file's diff SHALL remain the responsibility of the chat file-link `openDiffTab` path, unchanged by this requirement

## ADDED Requirements

### Requirement: Diff viewer Preview mode

The `diff`-viewer tab SHALL offer a `Diff / Preview` segmented control alongside the existing `File` view mode. In **Diff** mode it renders the unified red/green diff (current behavior). In **Preview** mode it renders the **changed regions** of the current file — context and added lines from the unified `gitDiff` in new-file line-number order, with removed lines omitted and additions tinted. Preview is derived client-side from the cached `gitDiff` with no server request; it is scoped to hunk regions and SHALL NOT be represented as the whole file (the existing `File` mode covers whole-file view). The mode SHALL default to Diff and SHALL NOT persist across mounts. When the file has no parseable `gitDiff` (non-git, summed-delta, or binary), the `Preview` control SHALL be disabled.

#### Scenario: Preview shows changed regions without removed lines
- **WHEN** the user selects `Preview` on a `diff`-viewer tab whose file has a parseable `gitDiff`
- **THEN** the tab SHALL render context and added lines in new-file line order
- **AND** no removed (`-`) lines SHALL be shown

#### Scenario: Diff is the default mode
- **WHEN** a `diff`-viewer tab first opens
- **THEN** it SHALL render in Diff mode
- **AND** the existing `File` (whole-file) mode SHALL remain available and unchanged

#### Scenario: Preview disabled without a parseable gitDiff
- **WHEN** the file backing the `diff`-viewer tab has no parseable `gitDiff` (non-git, summed, or binary)
- **THEN** the `Preview` control SHALL be disabled
- **AND** the tab SHALL remain in Diff mode
