# folder-action-bar

## MODIFIED Requirements

### Requirement: Folder action bar layout

Each folder group in the sidebar SHALL render a horizontal action bar below the group header containing buttons in this order: `Terminals(N)`, `Editor`, `Clean up broken (N)` (conditional), and Pi Resources (right-aligned). The action bar SHALL NOT contain native-editor (e.g. `Zed`) buttons, `+Session`, or `+Worktree` buttons — native-editor launch is removed, and spawn buttons live in the elevated spawn-button stack.

#### Scenario: Action bar omits native-editor and spawn buttons

- **WHEN** a folder group action bar is rendered for a git repository
- **THEN** the action bar SHALL display: Terminals(0), Editor, and the Pi Resources icon
- **THEN** the action bar SHALL NOT contain a `Zed` (or any native-editor) button
- **THEN** the action bar SHALL NOT contain a `+Session` button
- **THEN** the action bar SHALL NOT contain a `+Worktree` button

### Requirement: Editor button opens the internal folder pane

The Editor button SHALL navigate to `/folder/:encodedCwd/editor`, which mounts the internal Monaco editor pane rooted at the folder cwd (see capability `folder-scoped-editor-pane`). The button SHALL NOT display any `code-server` status indicator (green/pulsing/warning), because no external editor process exists.

#### Scenario: Click navigates to the internal folder pane

- **WHEN** the user clicks the Editor button
- **THEN** the content area SHALL navigate to `/folder/:encodedCwd/editor`
- **AND** the internal Monaco pane SHALL mount rooted at the folder cwd

#### Scenario: Editor button has no status indicator

- **WHEN** the Editor button is rendered for any folder
- **THEN** it SHALL NOT display a green/pulsing dot or a yellow warning icon

## REMOVED Requirements

### Requirement: Zed button for native launch

**Reason**: The native-editor launcher (`POST /api/open-editor`) is removed; the dashboard no longer launches Zed or any native editor.
**Migration**: Open files via the internal Monaco pane (the `[Editor]` button / file-open entry points). No native-launch affordance remains.
