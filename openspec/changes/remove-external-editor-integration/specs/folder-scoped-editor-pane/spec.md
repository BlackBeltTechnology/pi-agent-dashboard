# folder-scoped-editor-pane

## ADDED Requirements

### Requirement: Folder `[Editor]` route SHALL mount the internal Monaco pane rooted at the folder cwd

The `/folder/:encodedCwd/editor` route and the sidebar folder-action-bar `[Editor]` button SHALL open the **internal Monaco editor pane** (`editor-pane/`) rooted at the folder's `cwd`, replacing the former external `code-server` iframe (`EditorView`). The pane SHALL reuse the existing `EditorPane` component and all its viewers, tabs, and file-tree rail unchanged; only its state scope changes from session to folder.

The folder-scoped mount SHALL be driven by a `SplitWorkspaceProvider` given a synthetic, namespaced pane id derived from the folder cwd (`folderPaneId(cwd)`, e.g. `folder:<cwd>`) and the folder `cwd`. The provider SHALL omit the session-only wires (`onWatchFiles`, `fileResults`, `changedFiles`).

#### Scenario: Folder Editor button opens the internal pane

- **WHEN** the user clicks the `[Editor]` button for a folder group with cwd `/home/u/proj`
- **THEN** the content area SHALL navigate to `/folder/:encodedCwd/editor`
- **AND** the internal Monaco pane SHALL mount with its file-tree rail rooted at `/home/u/proj`
- **AND** no `code-server` process SHALL be started and no `/editor/<id>/` proxy SHALL be used

#### Scenario: Opening a file in the folder pane

- **GIVEN** the folder-scoped pane is open for `/home/u/proj`
- **WHEN** the user clicks `src/foo.ts` in the file-tree rail
- **THEN** `src/foo.ts` SHALL open as the active Monaco tab, rendered read-only via the viewer registry

### Requirement: Folder pane state SHALL persist keyed by folder path

Folder-scoped pane state (open tabs, active tab, expanded tree directories) SHALL persist in `localStorage` under a key namespaced by folder cwd, disjoint from session-keyed state. Reopening the same folder in the same browser profile SHALL restore its tabs and tree expansion. The synthetic folder id SHALL NOT collide with any real session id.

#### Scenario: Folder pane state survives reload

- **GIVEN** the folder pane for `/home/u/proj` has `src/foo.ts` and `README.md` open with `README.md` active
- **WHEN** the page is reloaded and the folder pane reopens
- **THEN** both tabs SHALL be restored with `README.md` active

#### Scenario: Folder and session state do not collide

- **GIVEN** a session whose cwd is `/home/u/proj` has one set of open tabs in its session-scoped pane
- **AND** the folder pane for `/home/u/proj` has a different set of open tabs
- **THEN** each SHALL load its own persisted state independently

### Requirement: Folder pane omits the changed-on-disk banner in v1

The folder-scoped pane SHALL NOT display the changed-on-disk banner, because there is no session WebSocket to drive the server file-watch. A manual Refresh SHALL reload a tab's content. This is an explicit v1 limitation; the session-scoped pane's changed-on-disk banner is unaffected.

#### Scenario: No changed-on-disk banner in folder scope

- **GIVEN** the folder pane for `/home/u/proj` has `src/foo.ts` open
- **WHEN** `src/foo.ts` is modified on disk by another process
- **THEN** no changed-on-disk banner SHALL appear in the folder pane
- **AND** clicking Refresh SHALL reload the tab with the current on-disk content
