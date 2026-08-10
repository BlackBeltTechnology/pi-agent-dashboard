# change-summary-table — delta

## MODIFIED Requirements

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
