## MODIFIED Requirements

### Requirement: Inline rename UI in SessionHeader
On desktop the SessionHeader SHALL render the session name as a title menu button; on mobile, Rename stays in the session actions (⋯) menu. Rename SHALL be reachable from the title-menu item "Rename" and from the F2 key while focus is in the header but not in an editable field; either entry point SHALL activate an inline text input for editing. F2 SHALL do nothing for an ended session. Leaving the input (confirm or cancel) SHALL return focus to the title button. The SessionHeader SHALL NOT render a pencil button, and double-clicking the name SHALL NOT start a rename.

#### Scenario: Activate rename via pencil icon
- **WHEN** the desktop SessionHeader renders
- **THEN** no pencil button is rendered next to the session name
- **AND** "Rename" is reachable from the title menu

#### Scenario: Activate rename via double-click
- **WHEN** user double-clicks on the session name text
- **THEN** no rename input appears, because the title is a menu button

#### Scenario: Activate rename via title menu
- **WHEN** user opens the title menu and selects "Rename"
- **THEN** the name SHALL become an editable text input pre-filled with the current name

#### Scenario: Activate rename via F2
- **WHEN** user presses F2 while focus is inside the session header and not in an editable field
- **THEN** the name SHALL become an editable text input pre-filled with the current name
- **AND** F2 pressed inside the tag editor input SHALL NOT start a rename

#### Scenario: Confirm rename
- **WHEN** user presses Enter in the rename input
- **THEN** a `rename_session` message SHALL be sent with the new name
- **AND** the input SHALL revert to display mode

#### Scenario: Cancel rename
- **WHEN** user presses Escape in the rename input
- **THEN** the input SHALL revert to display mode without sending any message
- **AND** focus SHALL return to the title button

#### Scenario: Empty name
- **WHEN** user confirms an empty or whitespace-only name
- **THEN** the name SHALL be treated as unset (sent as empty string or undefined)
