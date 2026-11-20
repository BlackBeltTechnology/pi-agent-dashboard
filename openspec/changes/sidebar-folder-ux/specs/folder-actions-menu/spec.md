## ADDED Requirements

### Requirement: Menu offers one-step removal from the sidebar

The `directory` group SHALL contain a **Remove from sidebar** item (`id: remove-from-sidebar`, neutral tone) for a folder that is pinned or owned by a workspace. Activating it SHALL detach the folder from its workspace and unpin it using the existing `remove_folder_from_workspace` and `unpin_directory` messages, as applicable. When any session in the folder has status other than `ended`, it SHALL first require confirmation as specified below.

#### Scenario: Pinned folder inside a workspace
- **GIVEN** a folder that is in workspace W and also pinned, with only ended sessions
- **WHEN** the user activates Remove from sidebar
- **THEN** `remove_folder_from_workspace` for W and `unpin_directory` SHALL both be sent
- **AND** the folder SHALL leave the default sidebar without archiving any session

#### Scenario: Pinned top-level folder
- **GIVEN** a pinned folder outside any workspace
- **WHEN** the user activates Remove from sidebar
- **THEN** only `unpin_directory` SHALL be sent

#### Scenario: Live sessions require confirmation
- **GIVEN** a pinned folder with two sessions whose status is not `ended`
- **WHEN** the user activates Remove from sidebar
- **THEN** a confirm dialog SHALL open listing both live sessions
- **AND** nothing SHALL be sent until the user confirms

#### Scenario: Confirm ends live sessions then removes
- **GIVEN** the confirm dialog for a pinned folder with live sessions A and B
- **WHEN** the user confirms
- **THEN** a `shutdown` message SHALL be sent for A and for B
- **AND** the removal messages (`remove_folder_from_workspace` / `unpin_directory`, as applicable) SHALL be sent after them

#### Scenario: Cancel changes nothing
- **GIVEN** the confirm dialog is open
- **WHEN** the user cancels or presses Escape
- **THEN** no message SHALL be sent and the folder SHALL stay in the sidebar

#### Scenario: Confirm dialog is accessible and defaults to Cancel
- **WHEN** the confirm dialog opens
- **THEN** it SHALL expose `role="dialog"` with `aria-modal="true"` and an accessible title
- **AND** keyboard focus SHALL be on Cancel, with Tab contained in the dialog and focus restored to the menu trigger on close

#### Scenario: Not offered where there is nothing to remove
- **GIVEN** an unpinned folder outside every workspace
- **WHEN** the menu opens
- **THEN** no Remove from sidebar item SHALL render

#### Scenario: Sessions stay reachable and a new session restores the folder
- **GIVEN** a folder removed from the sidebar
- **WHEN** the user types its path in the Folder filter, or a new session starts in it
- **THEN** the folder SHALL appear again with its sessions intact

### Requirement: Menu content stays reachable at short desktop heights

On a desktop-form (popover) folder actions menu, every item SHALL be reachable by wheel scroll and by keyboard when the menu is taller than the viewport space available to it: the panel SHALL be bounded to the viewport and scroll internally. The same SHALL hold for any other popover that lists directories or workspaces.

#### Scenario: Tall menu on a 1280×720 window
- **GIVEN** a viewport 1280px wide and 720px tall and a folder menu whose content exceeds 720px
- **WHEN** the menu opens
- **THEN** the panel bottom SHALL be at or above the viewport bottom
- **AND** scrolling the panel SHALL bring the last item into view

#### Scenario: Keyboard reaches the last item
- **GIVEN** the same open menu
- **WHEN** the user moves focus to the last item with the keyboard
- **THEN** that item SHALL be scrolled into view
