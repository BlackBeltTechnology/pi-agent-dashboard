# change-summary-table Specification

## Purpose
TBD - created by archiving change add-change-summary-table. Update Purpose after archive.
## Requirements
### Requirement: Per-turn inline change block
The client SHALL render a compact change-summary block at each assistant turn boundary that has at least one Edit or Write tool call, derived entirely client-side from tool-call events grouped by `turnIndex`. The block SHALL NOT require a network round-trip and SHALL NOT invoke any language model.

Each file row SHALL lead with a **mime-type icon** keyed by the file's extension (via the shared `fileIcon()` helper, the same icon used by the editor-pane file tree), NOT a status glyph. Added-versus-modified status SHALL remain conveyed by the row's `+additions −deletions` badges.

The block's expanded state SHALL be **derived from the changed-file count** until the user manually toggles it: the block SHALL render expanded when the file count is below the collapse threshold and collapsed when the file count reaches the threshold. The collapse threshold SHALL be 8 files (collapse when `fileCount >= 8`). Once the user manually toggles the block via its header, that choice SHALL be sticky and SHALL override the derived state for the remainder of the block's lifetime, even as more files stream in. Auto-fold SHALL only ever collapse a block; expansion SHALL always be either the initial below-threshold default or a manual user action.

#### Scenario: Turn with file changes
- **WHEN** an assistant turn contains one or more Edit or Write tool calls
- **THEN** a change block SHALL render for that turn
- **AND** each changed file SHALL show a mime-type icon keyed by its extension, its path, and `+additions −deletions`
- **AND** additions/deletions SHALL be computed from the Edit `oldText`/`newText` (or Write `content`) line deltas of that turn
- **AND** the block header SHALL show an aggregate `+X −Y · N files`

#### Scenario: Turn with no file changes
- **WHEN** an assistant turn contains no Edit or Write tool calls
- **THEN** no change block SHALL render for that turn

#### Scenario: Open a file from a row
- **WHEN** the user activates the open affordance on a file row
- **THEN** the client SHALL open that file using the existing open-in-editor path (`OpenFileButton` / `POST /api/open-editor`)

#### Scenario: Small changeset stays expanded
- **WHEN** a turn changes fewer than 8 files AND the user has not manually toggled the block
- **THEN** the block SHALL render expanded, showing every file row

#### Scenario: Large changeset auto-collapses
- **WHEN** a turn changes 8 or more files AND the user has not manually toggled the block
- **THEN** the block SHALL render collapsed, showing only its one-line header (`+X −Y · N files`)

#### Scenario: Streaming turn crosses the threshold
- **GIVEN** a still-streaming turn whose block was auto-expanded at fewer than 8 files
- **AND** the user has not manually toggled it
- **WHEN** an incoming Edit or Write brings the file count to 8 or more
- **THEN** the block SHALL auto-collapse to its header so it stops displacing the surrounding messages

#### Scenario: Manual override is sticky
- **GIVEN** a block with 8 or more files
- **WHEN** the user clicks the header to expand it
- **THEN** the block SHALL stay expanded
- **AND** subsequent files streaming into the same turn SHALL NOT auto-collapse it

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

### Requirement: Merged roll-up in the rail summary bar
The session-wide net roll-up SHALL be rendered in the slim Changes summary bar atop the pane rail (not a Changes-section header, not a separate pinned dock), sourced from `useSessionDiff` and the numstat-derived counts. Per-file net `+additions −deletions` SHALL be shown on each changed file's inline row in the workspace tree.

#### Scenario: Git session aggregate + per-file counts
- **WHEN** the session cwd is a git repository with changed files
- **THEN** the summary bar SHALL show the `Changes (N) · +X −Y` aggregate
- **AND** each inline changed-file row SHALL show that file's net `+additions −deletions` from the numstat fields
- **AND** each inline changed-file row SHALL provide the diff affordance

#### Scenario: Non-git session fallback
- **WHEN** the session cwd is not a git repository
- **THEN** the aggregate and per-file counts SHALL be summed per-turn event deltas instead of numstat
- **AND** the summary bar SHALL visibly flag that the counts are summed deltas rather than git-net (a `summed` badge)

#### Scenario: No changes
- **WHEN** the session has no file changes
- **THEN** the session-header summary chip SHALL be hidden and the summary bar SHALL be absent

### Requirement: Per-turn and net counts are distinct and labeled
The per-turn blocks and the running roll-up MAY report different totals for the same file (e.g. a line added in one turn and removed in another). The UI SHALL label each surface so the two are not read as contradictory.

#### Scenario: Added-then-removed reconciliation
- **WHEN** a line is added in one turn and removed in a later turn
- **THEN** the per-turn blocks SHALL each reflect that turn's activity (`+1 −0` then `+0 −1`)
- **AND** the roll-up SHALL reflect the net state (`+0 −0`) for that file
- **AND** the surfaces SHALL be labeled such that both readings are unambiguous

### Requirement: Diff viewer Preview mode

The `diff`-viewer tab SHALL offer a segmented control with four modes: **Diff**, **File**, **Regions**, and **Preview**. Diff mode renders the unified red/green diff (current behavior). File mode renders the whole current file as plain syntax-highlighted source (current behavior). The control SHALL default to Diff and SHALL NOT persist across mounts.

**Regions** is the mode formerly labelled `Preview`, renamed with its function unchanged: it renders the **changed regions** of the current file — context (` `) and added (`+`) lines from the parseable unified `gitDiff` in new-file line-number order, removed lines omitted and additions tinted, scoped to hunk regions. It is derived client-side from the cached `gitDiff` with no server request. When the file has no parseable `gitDiff` (non-git, summed-delta, or binary), the `Regions` control SHALL be disabled and the tab SHALL remain in Diff mode.

**Preview** is a new mode that renders the current on-disk file the diff was made against, through the shared **type-based renderer** selected by `fileKind(...).viewer` — the same `viewer-registry` component a file-tree open mounts, at the viewer-lookup layer (it is a stateless embed; it does NOT replicate `openInSplit`'s mtime/scroll/concurrency state). Because `fileKind()` throws on a relative path and `FileDiffEntry.path` is relative, the mode SHALL resolve the absolute path `join(cwd, file.path)` before calling `fileKind`; the `cwd` SHALL be threaded from `DiffViewer` (which already receives it) into `DiffPanel`. Because a `viewerRegistry` component requires the full `ViewerProps` including a `size` that `fileKind` does not provide, the mode SHALL fetch `GET /api/file?cwd&path` once for `{ kind, mimeType, size }`, then mount the viewer with the complete props. The viewer sources bytes from `/api/file*` (raw or content), not the diff panel's `/api/session-file`. Preview shows the current disk version and does NOT depend on `gitDiff`.

The `Preview` control SHALL be available whenever the backing entry is in-cwd (`previewable !== false`) and not a pure deletion; it SHALL be omitted or disabled when out-of-cwd (`previewable === false`, which includes all `otherChanges` entries). A `type:"tool"` entry in `files[]` (previewable, detected on disk) may have been deleted before the click; in that case the `GET /api/file` metadata fetch fails and the mode SHALL render a not-found/error state — the panel SHALL NOT crash. Preview and File coexist; for a plain code file both show source (accepted overlap).

#### Scenario: Regions shows changed regions without removed lines

- **WHEN** the user selects `Regions` on a `diff`-viewer tab whose file has a parseable `gitDiff`
- **THEN** the tab SHALL render context and added lines in new-file line order
- **AND** no removed (`-`) lines SHALL be shown

#### Scenario: Regions disabled without a parseable gitDiff

- **WHEN** the file backing the `diff`-viewer tab has no parseable `gitDiff` (non-git, summed, or binary)
- **THEN** the `Regions` control SHALL be disabled
- **AND** the tab SHALL remain in Diff mode

#### Scenario: Preview renders the current file via the type-based renderer

- **GIVEN** a `diff`-viewer tab for an in-cwd `README.md` (`previewable !== false`)
- **WHEN** the user selects `Preview`
- **THEN** the tab SHALL render the current on-disk `README.md` via the markdown viewer (rendered markdown, not source, not a diff)
- **AND** this SHALL hold regardless of whether the file has a parseable `gitDiff`

#### Scenario: Preview available for a non-git Edit diff

- **GIVEN** a `diff`-viewer tab whose file has no parseable `gitDiff` but is in-cwd and readable
- **WHEN** the tab renders its toolbar
- **THEN** the `Preview` control SHALL be available (enabled)
- **AND** selecting it renders the file through its `fileKind` viewer

#### Scenario: Preview unavailable for an out-of-cwd file

- **GIVEN** a `diff`-viewer tab whose backing file is out-of-cwd (`previewable === false`)
- **WHEN** the tab renders its toolbar
- **THEN** the `Preview` control SHALL be omitted or disabled

#### Scenario: Preview degrades gracefully for a deleted file

- **GIVEN** a `diff`-viewer tab for a `type:"tool"` entry in `files[]` (`previewable !== false`) whose file was deleted after the change
- **WHEN** the user selects `Preview`
- **THEN** the `GET /api/file` metadata fetch fails and the mode renders a not-found/error state
- **AND** the diff panel does NOT crash

#### Scenario: Diff is the default mode

- **WHEN** a `diff`-viewer tab first opens
- **THEN** it SHALL render in Diff mode
- **AND** the `File`, `Regions`, and `Preview` modes SHALL be available per their own gates

### Requirement: Out-of-cwd rows are gated and render from captured payload

A per-turn change-summary row for a session-authored file outside the session cwd SHALL be shown only when the `showOutOfCwdSessionDiffs` preference is enabled, and when selected SHALL open a `diff:`-viewer tab keyed by the file's absolute path that renders from the captured Write/Edit payload (`change.content` / `change.edits`) rather than the empty "No changes for this file" state. When the in-memory payload is truncated or its `edits` array is collapsed, the viewer SHALL attempt a lazy full-fidelity fetch by `(sessionId, toolCallId)`; on success it SHALL render the full content with NO size cap. On fetch failure it SHALL render the partial (truncated) diff with a "content truncated — full version unavailable" banner (or "diff too large to show inline" for a collapsed `edits` array), never a blank panel and never a filesystem read.

#### Scenario: out-of-cwd row hidden by default

- **GIVEN** `showOutOfCwdSessionDiffs` is off
- **WHEN** a turn wrote `/tmp/mockup/index.html`
- **THEN** the change-summary block SHALL NOT list that file

#### Scenario: out-of-cwd row renders a payload diff when enabled

- **GIVEN** `showOutOfCwdSessionDiffs` is on
- **WHEN** the user clicks the `/tmp/mockup/index.html` row
- **THEN** a `diff:`-viewer tab SHALL open AND render the diff from the captured payload (not the empty state)

#### Scenario: large payload upgrades to full fidelity, no cap

- **GIVEN** the row's in-memory `content` is truncated at ~4 KB and the full file is large (e.g. 1 MB)
- **WHEN** the diff tab opens
- **THEN** the viewer SHALL lazily fetch the full payload by `(sessionId, toolCallId)` and render the complete diff with no size cap

#### Scenario: lazy fetch fails

- **GIVEN** the in-memory payload is truncated AND the lazy full-payload fetch fails
- **THEN** the viewer SHALL render the partial diff with a "content truncated — full version unavailable" banner (never a blank panel, never a filesystem read)

### Requirement: Out-of-cwd entries handled safely in tree and preview surfaces

An out-of-cwd entry keyed by an absolute path SHALL NOT be merged into the cwd-relative file
tree (splitting an absolute path on `/` yields a blank-root node). It SHALL be presented in a
distinct "outside workspace" grouping or dedicated leaf. The entry SHALL carry `previewable:
false`, and the diff viewer SHALL hide the file-content view toggle for it (that toggle fetches
`/api/session-file`, which correctly 403s out-of-cwd) so the user never hits an error dialog.

#### Scenario: absolute path does not corrupt the tree

- **GIVEN** an out-of-cwd entry keyed `/tmp/mockup/index.html` alongside in-cwd relative entries
- **THEN** the file tree SHALL NOT render a blank-root node and the out-of-cwd entry SHALL appear in its own grouping

#### Scenario: file-content toggle hidden for out-of-cwd

- **GIVEN** an out-of-cwd diff tab with `previewable: false`
- **THEN** the viewer SHALL NOT show the "File" content-view toggle (no `/api/session-file` 403 dialog)

