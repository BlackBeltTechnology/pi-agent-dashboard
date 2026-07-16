# change-summary-table (delta)

## ADDED Requirements

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
