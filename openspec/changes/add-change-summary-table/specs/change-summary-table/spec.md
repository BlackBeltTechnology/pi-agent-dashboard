## ADDED Requirements

### Requirement: Per-turn inline change block
The client SHALL render a compact change-summary block at each assistant turn boundary that has at least one Edit or Write tool call, derived entirely client-side from tool-call events grouped by `turnIndex`. The block SHALL NOT require a network round-trip and SHALL NOT invoke any language model.

#### Scenario: Turn with file changes
- **WHEN** an assistant turn contains one or more Edit or Write tool calls
- **THEN** a change block SHALL render for that turn
- **AND** each changed file SHALL show a status glyph (● modified / + added), its path, and `+additions −deletions`
- **AND** additions/deletions SHALL be computed from the Edit `oldText`/`newText` (or Write `content`) line deltas of that turn
- **AND** the block header SHALL show an aggregate `+X −Y · N files`

#### Scenario: Turn with no file changes
- **WHEN** an assistant turn contains no Edit or Write tool calls
- **THEN** no change block SHALL render for that turn

#### Scenario: Open a file from a row
- **WHEN** the user activates the open affordance on a file row
- **THEN** the client SHALL open that file using the existing open-in-editor path (`OpenFileButton` / `POST /api/open-editor`)

#### Scenario: Overflow collapse
- **WHEN** a turn changes more files than the display threshold
- **THEN** the block SHALL show the first N rows and a "+M more" affordance that reveals the remainder in place

### Requirement: Changed Files integrated into the split editor pane
The client SHALL surface changed files inside the split editor pane rather than as a full-screen takeover: a Changes section pinned atop the pane's project-tree rail, with each file's diff opened as a per-file `diff`-viewer tab (a new `ViewerKind` `diff`). A `SplitWorkspaceContext` helper `openChanges()` SHALL open the split and reveal the Changes section. The chat SHALL remain mounted in the adjacent pane.

#### Scenario: Open changed files into the split
- **WHEN** the user activates the session-header Changed Files summary chip
- **THEN** `openChanges()` SHALL open the split (if closed) and reveal the Changes section in the pane rail
- **AND** `ChatView` SHALL remain mounted in the adjacent pane (no takeover)

#### Scenario: Open a specific file's diff
- **WHEN** the user activates a Changes-section row OR the open affordance on a per-turn block file row
- **THEN** that file SHALL open/activate as a `diff`-viewer tab (sibling to normal file tabs)
- **AND** the Changes section SHALL mark that file as the active selection

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

### Requirement: Merged roll-up in the Changes-section header
The session-wide net roll-up SHALL be rendered as the header of the Changes section in the pane rail (not a separate pinned dock), sourced from `useSessionDiff` and the numstat-derived counts. Changes-section rows SHALL carry per-file net `+additions −deletions`.

#### Scenario: Git session aggregate + per-file counts
- **WHEN** the session cwd is a git repository with changed files
- **THEN** the Changes-section header SHALL show the `N files · +X −Y` aggregate
- **AND** each row SHALL show that file's net `+additions −deletions` from the numstat fields
- **AND** each row SHALL provide the open-in-editor affordance

#### Scenario: Non-git session fallback
- **WHEN** the session cwd is not a git repository
- **THEN** the aggregate and per-file counts SHALL be summed per-turn event deltas instead of numstat
- **AND** the header SHALL visibly flag that the counts are summed deltas rather than git-net (a `summed` badge)

#### Scenario: No changes
- **WHEN** the session has no file changes
- **THEN** the session-header summary chip SHALL be hidden and the Changes section SHALL be absent

### Requirement: Per-turn and net counts are distinct and labeled
The per-turn blocks and the running roll-up MAY report different totals for the same file (e.g. a line added in one turn and removed in another). The UI SHALL label each surface so the two are not read as contradictory.

#### Scenario: Added-then-removed reconciliation
- **WHEN** a line is added in one turn and removed in a later turn
- **THEN** the per-turn blocks SHALL each reflect that turn's activity (`+1 −0` then `+0 −1`)
- **AND** the roll-up SHALL reflect the net state (`+0 −0`) for that file
- **AND** the surfaces SHALL be labeled such that both readings are unambiguous
