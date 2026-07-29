# folder-action-bar — delta

## MODIFIED Requirements

### Requirement: Folder action bar layout

Each folder group in the sidebar SHALL render its action controls on the SAME
row as the group git info (`GroupGitInfo`): the git info is left-aligned
(`min-w-0`) and the `FolderActionBar` is right-grouped (`ml-auto`, content
width). The action bar SHALL contain, in order: the Initialize control
(conditional, see the Initialize Requirements), `Clean up broken (N)`
(conditional), and Directory Settings (the right-most gear icon). The action bar
SHALL NOT contain a `Terminals(N)` button, an `Editor` button, a native-editor
(e.g. `Zed`) button, a `+Session` button, or a `+Worktree` button — Terminals
and Editor are removed (the internal folder editor pane at
`/folder/:encodedCwd/editor` remains reachable from the Directory home page and
ChatView), native-editor launch is removed, and spawn buttons live in the
elevated spawn-button stack.

#### Scenario: Action bar omits Terminals, Editor, native-editor, and spawn buttons

- **WHEN** a folder group action bar is rendered for a git repository
- **THEN** the action bar SHALL NOT contain a `Terminals(N)` button
- **THEN** the action bar SHALL NOT contain an `Editor` button
- **THEN** the action bar SHALL NOT contain a `Zed` (or any native-editor) button
- **THEN** the action bar SHALL NOT contain a `+Session` button
- **THEN** the action bar SHALL NOT contain a `+Worktree` button

#### Scenario: Actions share the git row, right-grouped

- **WHEN** a folder group header is rendered expanded
- **THEN** the git info and the action bar SHALL render on one row
- **AND** the git info SHALL be left-aligned and the action bar SHALL be right-grouped
- **AND** the Directory Settings gear SHALL be the right-most control

## REMOVED Requirements

### Requirement: Terminals button with count badge

**Reason**: The Terminals button is removed from the folder action bar. Its
navigation target (`/folder/:encodedCwd/editor`) was identical to the Editor
button's, and the internal editor pane hosts terminals as tabs and is reachable
from the Directory home page and ChatView. The standalone `TerminalsView` and
the `/folder/:encodedCwd/terminals` route this Requirement referenced were
already removed by the `terminals-in-tabbed-panes` change.

### Requirement: Editor button opens the internal folder pane

**Reason**: The Editor button is removed from the folder action bar. The
internal Monaco pane at `/folder/:encodedCwd/editor` remains reachable from the
Directory home page (`DirectoryHomeView`) and ChatView, so the sidebar button
duplicated an existing entry point.
