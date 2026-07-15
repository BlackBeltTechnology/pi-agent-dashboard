# change-summary-table — delta

## MODIFIED Requirements

### Requirement: Changed Files integrated into the split editor pane
The client SHALL surface changed files inside the split editor pane rather than as a full-screen takeover: a Changes section pinned atop the pane's project-tree rail, with each file's diff opened as a per-file `diff`-viewer tab (a new `ViewerKind` `diff`). A `SplitWorkspaceContext` helper `openChanges()` SHALL open the split and reveal the Changes section. The chat SHALL remain mounted in the adjacent pane.

Changed-file paths derived client-side from raw tool-call `args.path` SHALL be normalized to relative-posix when they are absolute AND under the session cwd, using the same rule the server applies (`session-diff-extraction`: absolute-under-cwd → relative-posix). The normalized path SHALL be used BOTH for the displayed row AND for the value passed to `openDiffTab`, so the row and the diff-open lookup can never diverge and always match the session-diff `data.files` keys.

#### Scenario: Open changed files into the split
- **WHEN** the user activates the session-header Changed Files summary chip
- **THEN** `openChanges()` SHALL open the split (if closed) and reveal the Changes section in the pane rail
- **AND** `ChatView` SHALL remain mounted in the adjacent pane (no takeover)

#### Scenario: Open a specific file's diff
- **WHEN** the user activates a Changes-section row OR the open affordance on a per-turn block file row
- **THEN** that file SHALL open/activate as a `diff`-viewer tab (sibling to normal file tabs)
- **AND** the Changes section SHALL mark that file as the active selection

#### Scenario: Absolute-path tool call opens the correct diff
- **WHEN** a per-turn block file row was derived from a tool call whose `args.path` was absolute and under the session cwd (e.g., `/home/user/project/openspec/changes/x/proposal.md`)
- **THEN** activating the row SHALL open a `diff`-viewer tab whose path matches the relative-posix session-diff key (`openspec/changes/x/proposal.md`)
- **AND** the diff panel SHALL render the file's changes (it SHALL NOT show "No changes for this file")

#### Scenario: Diff tab coexists with a monaco tab for the same file
- **WHEN** a file is already open as a `monaco` tab AND the same file is opened as a diff
- **THEN** a separate `diff`-viewer tab SHALL open (the two SHALL NOT collapse into one tab)
- **AND** both tabs SHALL be independently selectable

#### Scenario: Persisted diff tab survives reload
- **WHEN** a `diff`-viewer tab is open AND the page is reloaded
- **THEN** the restored editor-pane state SHALL retain the `diff` tab (it SHALL NOT be discarded as an invalid viewer)

#### Scenario: Diff render uses shared session-diff data, no per-tab fetch
- **WHEN** a `diff`-viewer tab renders a file
- **THEN** it SHALL read that file's diff from the shared session-diff data already loaded for the session
- **AND** opening the tab SHALL NOT trigger an additional per-file network request

#### Scenario: Fallback takeover route retained
- **WHEN** the `/session/:id/diff` route is navigated (deep-link or very narrow mobile)
- **THEN** the standalone `FileDiffView` SHALL render the same enriched changed-files tree as a full-screen view
