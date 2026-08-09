## Purpose

Sidebar UI for pinning directory groups: pin toggle on headers, always-visible pinned groups, drag-to-reorder, manual pin dialog, and visual distinction between pinned and unpinned groups.
## Requirements
### Requirement: Pin toggle on directory group headers

Each directory group header SHALL expose a pin toggle as an item in the folder actions menu, not as an icon in the header row. The item SHALL read as pinning when the directory is unpinned and as unpinning when it is pinned. The item SHALL be present only where pinning is meaningful — that is, outside a workspace container.

The left side of the header SHALL continue to display a folder icon: `mdiFolderOpen` when the group is expanded, `mdiFolder` when collapsed.

Pinned state SHALL remain visually distinguishable on the header itself without a dedicated toggle button. The header SHALL retain a **non-interactive** `mdiPin` indicator when the directory is pinned, and render no indicator when it is not, so the user can still tell pinned groups apart at a glance.

This knowingly places `mdiPin` in two roles on one card: state in the header, and action inside the menu. That is accepted as the least-bad option — a different indicator glyph would sever the visual link to the action that produces it. The two are distinguishable by interactivity: the header indicator is not a button and has no hover or focus affordance.

#### Scenario: Pinned directory group header

- **WHEN** a directory group is pinned and expanded
- **THEN** the left icon SHALL be `mdiFolderOpen`
- **AND** the header SHALL render a non-interactive `mdiPin` indicator
- **AND** that indicator SHALL NOT be focusable or activatable
- **AND** no pin toggle button SHALL render in the header row

#### Scenario: Unpinned group renders no indicator

- **WHEN** a directory group is not pinned
- **THEN** the header SHALL render no `mdiPin` indicator

#### Scenario: Unpin from the menu

- **GIVEN** a pinned directory outside any workspace
- **WHEN** the user opens the folder actions menu and activates the pin item
- **THEN** the directory SHALL be unpinned

#### Scenario: Pin from the menu

- **GIVEN** an unpinned directory outside any workspace
- **WHEN** the user opens the folder actions menu and activates the pin item
- **THEN** the directory SHALL be pinned

#### Scenario: Workspace-owned folder offers no pin item

- **GIVEN** a folder inside a workspace container
- **WHEN** the folder actions menu opens
- **THEN** no pin item SHALL render

#### Scenario: Pinned directory group header collapsed

- **WHEN** a directory group is pinned and collapsed
- **THEN** the left icon SHALL be `mdiFolder`
- **AND** the header SHALL render the non-interactive `mdiPin` indicator

#### Scenario: No duplicate pin indicator on left

- **WHEN** a directory group is pinned
- **THEN** the left side SHALL NOT display a pin icon — only the folder icon

### Requirement: Pinned directory groups always visible
Pinned directory groups SHALL always appear in the sidebar, even when they have zero sessions.

#### Scenario: Pinned directory with no sessions
- **WHEN** a directory is pinned but has no connected sessions
- **THEN** the group header SHALL still render, showing the directory name and "(0)" session count

#### Scenario: Pinned directory with no sessions shows spawn button
- **WHEN** a pinned directory has zero sessions
- **THEN** the group header SHALL display a "+ New" button to spawn a session in that directory

#### Scenario: Active-only filter does not hide pinned groups
- **WHEN** "Active only" filter is enabled and a pinned directory has only ended sessions
- **THEN** the pinned group header SHALL still be visible (sessions within may be filtered, but the group remains)

### Requirement: Drag-to-reorder pinned directories
Users SHALL be able to reorder pinned directory groups by dragging, regardless of whether the source group, the target group, or both are expanded or collapsed at the moment the drag begins. The sidebar's drag-and-drop collision detection SHALL constrain candidate drop targets to droppables of the same drag `type` as the active draggable before measuring distances, so that nested sortable contexts (e.g., session cards inside an expanded group) do not capture a pinned-group drag intended for another pinned group.

#### Scenario: Drag pinned directory to new position
- **WHEN** a user drags a pinned directory group from position 1 to position 3
- **THEN** the pinned directories list SHALL update to reflect the new order and persist the change

#### Scenario: Drag only within pinned section
- **WHEN** a user attempts to drag a pinned directory
- **THEN** the drag SHALL only allow reordering within the pinned section (cannot drag to unpinned section)

#### Scenario: Unpinned directories are not draggable
- **WHEN** a user attempts to drag an unpinned directory group
- **THEN** the drag SHALL not initiate (unpinned groups are auto-sorted by recency)

#### Scenario: Reorder works when source and target are both expanded
- **WHEN** two pinned directory groups are both expanded (their session cards are visible) and a user drags the source group's drag-handle onto the target group's header
- **THEN** the pinned directories list SHALL update to reflect the swapped order and persist the change
- **AND** no session card inside either group SHALL be reordered

#### Scenario: Reorder works when source is expanded and target is collapsed
- **WHEN** the dragged pinned group is expanded but the target group is collapsed
- **THEN** the pinned directories list SHALL update to reflect the new order and persist the change

#### Scenario: Reorder works when source is collapsed and target is expanded
- **WHEN** the dragged pinned group is collapsed but the target group is expanded
- **THEN** the pinned directories list SHALL update to reflect the new order and persist the change

#### Scenario: Session-card drag inside an expanded group does not reorder pinned groups
- **WHEN** a user drags a session card from one position to another inside an expanded pinned group
- **THEN** only the per-folder session order SHALL update; the pinned directories order SHALL remain unchanged

### Requirement: Manual pin dialog
Users SHALL be able to pin a directory path that is not currently visible in the sidebar. The dialog SHALL render via DialogPortal at document.body with z-[60].

#### Scenario: Open pin dialog
- **WHEN** a user clicks the "Pin directory" action (e.g., a button in the sidebar header area)
- **THEN** a dialog SHALL appear with a PathPicker component for selecting a directory
- **AND** the dialog is rendered at document.body via DialogPortal

#### Scenario: Pin directory from dialog
- **WHEN** a user selects a path and confirms in the pin dialog
- **THEN** the directory SHALL be pinned and appear in the pinned section

### Requirement: Pin directory dialog ownership
The `PinDirectoryDialog` SHALL be mounted at the application root (`App.tsx`) and SHALL be opened by any component via an app-provided `onOpenPinDialog` callback. The sidebar "Add folder" button SHALL no longer own the dialog's mount state; it SHALL call `onOpenPinDialog` instead.

#### Scenario: Sidebar button triggers the shared dialog
- **GIVEN** the dashboard is mounted
- **WHEN** the user clicks the sidebar "Add folder" button
- **THEN** `SessionList` SHALL invoke `onOpenPinDialog` from its props
- **AND** the application root SHALL render `<PinDirectoryDialog>` via `DialogPortal`
- **AND** confirming a directory SHALL dispatch `{ type: "pin_directory", path }` over the WebSocket, identical to the previous behaviour

#### Scenario: LandingPage triggers the same shared dialog
- **GIVEN** the LandingPage is rendered in its empty state
- **WHEN** the user activates the Step ② "Add folder" CTA
- **THEN** `LandingPage` SHALL invoke the same `onOpenPinDialog` callback
- **AND** the `PinDirectoryDialog` SHALL appear without rendering a second instance anywhere in the tree

#### Scenario: Dialog state resets between opens
- **GIVEN** the user has opened and closed `PinDirectoryDialog` at least once
- **WHEN** the user opens it again from either entry point
- **THEN** the dialog SHALL appear with a fresh input state

### Requirement: Pin directory dialog uses PathPicker
Pin directory dialog (`PinDirectoryDialog.tsx`) SHALL use the `PathPicker` component for directory selection. The dialog SHALL serve as a thin wrapper providing the title and calling `onPin` with the selected path. All path navigation (typing, filtering, browsing) SHALL be handled by PathPicker internally.

#### Scenario: Directory selection delegates to PathPicker
- **WHEN** the pin directory dialog is open
- **THEN** it SHALL render `PathPicker` for path navigation, filtering, and browsing
- **AND** confirming a selection SHALL call `onPin` with the selected path

### Requirement: Visual distinction between pinned and unpinned groups
The sidebar SHALL visually distinguish pinned directory groups from unpinned ones.

#### Scenario: Pinned group appearance
- **WHEN** a directory group is pinned
- **THEN** the group header SHALL display a 📌 icon (or equivalent) to indicate pinned status

#### Scenario: Section separator
- **WHEN** both pinned and unpinned directory groups exist
- **THEN** a visual separator (subtle line or spacing) SHALL appear between the pinned and unpinned sections

