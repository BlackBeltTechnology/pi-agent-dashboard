## ADDED Requirements

### Requirement: Split-pane layout
The file diff view SHALL render as a horizontally split pane within the content area: a file tree panel on the left and a diff/content panel on the right.

#### Scenario: Default layout
- **WHEN** the file diff view is active
- **THEN** the left panel SHALL default to 250px width and be resizable via drag handle (150px–500px range)
- **AND** the right panel SHALL fill the remaining space
- **AND** both panels SHALL be independently scrollable

#### Scenario: Mobile layout
- **WHEN** the viewport is mobile-sized
- **THEN** the file tree SHALL render as a collapsible header/dropdown above the diff panel (stacked vertically)

### Requirement: Two-level file tree with change events
The file tree panel SHALL display changed files as a directory tree. Each file node SHALL be expandable to reveal its individual change events with timestamps.

#### Scenario: File-level nodes
- **WHEN** the file tree is rendered
- **THEN** each changed file SHALL appear as a node with a status indicator
- **AND** files with status "write" (only Write events, no prior content) SHALL show a green "+" indicator
- **AND** files with status "edit" (at least one Edit event) SHALL show a yellow "●" indicator
- **AND** the number of changes per file SHALL be shown (e.g., "3 changes")

#### Scenario: Change event child nodes
- **WHEN** a file node is expanded
- **THEN** each individual change event SHALL appear as a child node
- **AND** each child node SHALL show the timestamp (formatted as relative time, e.g., "5 min ago")
- **AND** each child node SHALL show a truncated context message (the assistant's reason for the change) if available

#### Scenario: Directory grouping
- **WHEN** multiple changed files share a common directory prefix
- **THEN** they SHALL be grouped under collapsible directory nodes

#### Scenario: File selection shows most recent change
- **WHEN** a user clicks a file node (not a change event child)
- **THEN** the right panel SHALL display the git aggregate diff if available, otherwise the most recent change

#### Scenario: Change event selection shows specific change
- **WHEN** a user clicks a specific change event child node
- **THEN** the right panel SHALL display that particular change (Edit → oldText/newText diff, Write → full content as additions)

#### Scenario: Aggregate stats
- **WHEN** the file tree is displayed
- **THEN** a summary line SHALL show the total number of changed files (e.g., "5 files changed")

### Requirement: Rich diff rendering
The diff panel SHALL render diffs using `@git-diff-view/react` with syntax highlighting via `@git-diff-view/lowlight`.

#### Scenario: Edit change displayed
- **WHEN** an Edit change event is selected
- **THEN** the diff SHALL render using file comparison mode (`@git-diff-view/file`) with `oldText` as the old content and `newText` as the new content
- **AND** syntax highlighting SHALL be applied based on file extension

#### Scenario: Write change displayed
- **WHEN** a Write change event is selected
- **THEN** the panel SHALL show the written content with all lines as additions (new file)
- **AND** syntax highlighting SHALL be applied based on file extension

#### Scenario: Git aggregate diff displayed
- **WHEN** a file node is selected and `gitDiff` data is available
- **THEN** the diff SHALL render using git diff mode (`@git-diff-view/core`) consuming the unified diff output

#### Scenario: Split and unified mode toggle
- **WHEN** viewing a diff
- **THEN** the user SHALL be able to toggle between split (side-by-side) and unified diff modes
- **AND** the selected mode SHALL persist while the view is open

#### Scenario: Dark theme support
- **WHEN** the dashboard is using a dark theme
- **THEN** the diff view SHALL use dark theme colors consistent with the dashboard

### Requirement: File content view toggle
The diff panel SHALL support toggling to view the current file content.

#### Scenario: Switch to file content
- **WHEN** the user toggles to "File" mode
- **THEN** the panel SHALL display the current file content with syntax highlighting
- **AND** the content SHALL be fetched via the existing `/api/pi-resource-file` endpoint

#### Scenario: Switch back to diff
- **WHEN** the user toggles back to "Diff" mode
- **THEN** the panel SHALL display the diff view again

### Requirement: Content-area integration and button visibility
The file diff view SHALL integrate into App.tsx as a content-area view. The trigger button SHALL only appear when file changes are detected. The view SHALL render on **both** the mobile shell render path and the desktop content-area render path whenever the URL matches `/session/:id/diff`, regardless of whether the route also matches a `selectedId`-bearing pattern.

#### Scenario: Button placement
- **WHEN** the session has file changes (Write/Edit tool events detected in session state)
- **THEN** a "Changed Files" button SHALL appear in the SessionHeader, right-aligned before the Fork button

#### Scenario: Button hidden when no changes
- **WHEN** the session has no Write/Edit tool events
- **THEN** the "Changed Files" button SHALL NOT be displayed

#### Scenario: Activation
- **WHEN** the user clicks the "Changed Files" button
- **THEN** the ChatView SHALL be replaced by the file diff view
- **AND** a back button SHALL be available to return to the ChatView

#### Scenario: Desktop diff URL renders FileDiffView
- **WHEN** the user is on a desktop viewport (i.e. the `MobileShell` content path is not active) and the URL is `/session/:id/diff` for a known session id
- **THEN** the content area SHALL render `<FileDiffView>` for that session id
- **AND** the global `<LandingPage>` empty state ("Pick a session on the left to continue") SHALL NOT be displayed
- **AND** the `<SessionHeader>` SHALL remain rendered above the diff view, with the normal session controls available

#### Scenario: Mobile diff URL renders FileDiffView
- **WHEN** the user is on a mobile viewport and the URL is `/session/:id/diff` for a known session id
- **THEN** the `MobileShell` detail panel SHALL render `<FileDiffView>` for that session id
- **AND** the global `<LandingPage>` empty state SHALL NOT be displayed

#### Scenario: Session change clears view
- **WHEN** the user switches to a different session while the file diff view is open
- **THEN** the file diff view SHALL close automatically

### Requirement: Loading and empty states
The file diff view SHALL handle loading and empty states gracefully.

#### Scenario: Loading state
- **WHEN** the diff data is being fetched from the server
- **THEN** the view SHALL show a loading spinner or skeleton

#### Scenario: No changes detected
- **WHEN** the API returns an empty file list
- **THEN** the view SHALL display "No file changes detected in this session"

#### Scenario: Error state
- **WHEN** the API request fails
- **THEN** the view SHALL display an error message with a retry button

### Requirement: Refresh capability
The file diff view SHALL support manual refresh to pick up new changes.

#### Scenario: Refresh button
- **WHEN** the user clicks a refresh button in the file diff view header
- **THEN** the diff data SHALL be re-fetched from the server
- **AND** the currently selected file SHALL remain selected if still present
