# file-diff-view — delta

## MODIFIED Requirements

### Requirement: Rich diff rendering
The change/diff detail panel SHALL render a syntax-highlighted diff for the selected file. Rendering SHALL follow a stated precedence so the panel never blanks when the file exists in the session-diff data, whether or not the cwd is a git repository.

The precedence SHALL be:
1. If a specific change event is selected, render that change's derived texts (Edit `oldText`/`newText`, or Write `content` as all-additions).
2. Else if the file carries a `gitDiff` (git repo: real diff, or the synthetic `--- /dev/null` diff for an untracked new file), render the git hunks.
3. Else (non-git cwd, git unavailable, or no `gitDiff`), derive the diff from the file's own session change payload (most recent Write `content` / Edit ops) and render it.

#### Scenario: Edit change displayed
- **WHEN** an Edit change is selected
- **THEN** the panel SHALL render the diff from the change's `oldText`/`newText`

#### Scenario: Write change displayed
- **WHEN** a Write change is selected
- **THEN** the panel SHALL render the content with all lines as additions (new file)

#### Scenario: Git aggregate diff displayed
- **WHEN** no specific change is selected AND the file carries a `gitDiff`
- **THEN** the panel SHALL render the git diff hunks

#### Scenario: Non-git session fallback (never blank)
- **WHEN** no specific change is selected AND the file has no `gitDiff` (non-git cwd or git unavailable)
- **AND** the file exists in the session-diff `data.files`
- **THEN** the panel SHALL render a diff derived from the file's session change payload
- **AND** the panel SHALL NOT show an empty / "No diff data available" state

### Requirement: File content view toggle
The diff panel SHALL support toggling to view the current file content, and this file preview SHALL be surfaced as a first-class, persistently visible control in the split `DiffViewer` tab (not hidden behind a diff-only toolbar). The default view SHALL be the diff.

#### Scenario: Switch to file content
- **WHEN** the user activates the "File" / "Preview" control
- **THEN** the panel SHALL display the current file content with syntax highlighting
- **AND** the content SHALL be fetched via the existing session-file endpoint (`/api/session-file`)

#### Scenario: First-class preview control in the split diff tab
- **WHEN** a `diff`-viewer tab is open in the split editor pane
- **THEN** a labeled file-preview control SHALL be visible in that tab's header
- **AND** it SHALL be reachable in one click without opening any overflow/diff-only menu

#### Scenario: Switch back to diff
- **WHEN** the user toggles back to "Diff" mode
- **THEN** the panel SHALL display the diff view again
