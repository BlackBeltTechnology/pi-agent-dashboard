# change-summary-table Specification

## Purpose
TBD - created by archiving change add-change-summary-table. Update Purpose after archive.
## Requirements
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

### Requirement: Per-turn change block gated by a display preference
The per-turn inline change block SHALL be gated by a new `DisplayPrefs` boolean axis `changeSummaryTable`, following the same global + per-session-override mechanism as the other chat-view display axes (`toolResults`, `tokenStatsBar`, etc.). The global value SHALL be editable in the Settings-panel display section (deferred Save) and the per-session value SHALL be editable in the ⚙ View popover (`ChatViewMenu`) with instant apply and a "Use global settings" reset. The effective value SHALL be `mergeDisplayPrefs(global, sessionOverride)`. `changeSummaryTable` SHALL default to `false` in the `simple` preset and `true` in the `standard` and `everything` presets, and SHALL be backfilled to `true` for legacy `preferences.json` that predates the field.

#### Scenario: Enabled renders the block
- **GIVEN** effective `changeSummaryTable = true`
- **WHEN** an assistant turn contains one or more Edit or Write tool calls
- **THEN** the per-turn change block SHALL render for that turn

#### Scenario: Disabled globally hides the block
- **GIVEN** global `displayPrefs.changeSummaryTable = false` and no per-session override
- **WHEN** an assistant turn contains Edit or Write tool calls
- **THEN** no per-turn change block SHALL render

#### Scenario: Per-session override beats the global default
- **GIVEN** global `displayPrefs.changeSummaryTable = true`
- **AND** the session sets `displayPrefsOverride { changeSummaryTable: false }` via the ⚙ View popover
- **WHEN** effective prefs are computed
- **THEN** `changeSummaryTable` SHALL be `false` and the per-turn block SHALL NOT render for that session
- **AND** other sessions without an override SHALL still render the block

#### Scenario: View popover exposes the toggle
- **GIVEN** a selected session and the ⚙ View popover open
- **WHEN** the user toggles the change-summary axis
- **THEN** the client SHALL send `setSessionDisplayPrefs { sessionId, override }` immediately
- **AND** the chat view SHALL show/hide the per-turn blocks without a separate save step

#### Scenario: Legacy preferences backfill
- **GIVEN** a persisted `displayPrefs` object that predates the `changeSummaryTable` field
- **WHEN** the preferences store loads it
- **THEN** `changeSummaryTable` SHALL be set to `true` before it reaches any client

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

