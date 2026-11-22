## MODIFIED Requirements

### Requirement: Folder header shows the active grouping
When a folder's effective mode is not `none`, the folder header SHALL show a compact grouping indicator naming the mode, placed on the header's secondary (path) row so it does not truncate the folder name. When the mode is inherited from the global default, the indicator SHALL say so (e.g. "Status · default"). Activating the indicator SHALL open the folder actions menu. The indicator SHALL remain visible when the folder is collapsed and when only one lane is non-empty, EXCEPT in the accordion compact modes (`folder-focus`), which render no Group-by row; the grouping stays reachable from the folder actions menu.

#### Scenario: Inherited mode indicator
- **WHEN** the global default is `status` and `/repo` has no explicit mode
- **THEN** `/repo`'s header SHALL show "Status · default"

#### Scenario: No indicator in None mode
- **WHEN** `/repo`'s effective mode is `none`
- **THEN** no grouping indicator SHALL render

#### Scenario: Indicator opens the menu
- **WHEN** the user activates the grouping indicator
- **THEN** the folder actions menu SHALL open with the Group by choices focused on the current selection

#### Scenario: Compact accordion folder has no indicator row
- **GIVEN** accordion mode, unfocused `/repo` in a compact mode, and an effective grouping mode other than `none`
- **THEN** no grouping indicator SHALL render for `/repo`
- **AND** the folder actions menu SHALL still offer the Group by choices

#### Scenario: Collapsed classic folder keeps the indicator
- **GIVEN** classic mode and a collapsed `/repo` with an effective grouping mode other than `none`
- **THEN** the grouping indicator SHALL render
