## Purpose

[Spec purpose]
## Requirements
### Requirement: Session name field on DashboardSession
The `DashboardSession` type SHALL include an optional `name?: string` field representing the user-defined display name.

#### Scenario: Session with name set
- **WHEN** a session has `name` set to a non-empty string
- **THEN** the display name SHALL be the value of `name`

#### Scenario: Session without name
- **WHEN** a session has `name` undefined or empty
- **THEN** the display name SHALL fall back to `cwd.split("/").pop()`

### Requirement: Extension polls session name
The bridge extension SHALL read `pi.getSessionName()` on session start and periodically (every 30s). When the name changes, it SHALL send a `session_name_update` message to the server.

#### Scenario: Initial name on register
- **WHEN** the extension registers a session
- **THEN** it SHALL include the current session name (if set) in the `session_register` message

#### Scenario: Name change detected by poll
- **WHEN** `pi.getSessionName()` returns a different value than the last known name
- **THEN** the extension SHALL send a `session_name_update` message with the new name

#### Scenario: Name unchanged
- **WHEN** `pi.getSessionName()` returns the same value as last known
- **THEN** no message SHALL be sent

### Requirement: Dashboard-initiated rename
When a rename is initiated from the dashboard UI, the server SHALL send a `rename_session` message to the extension. The extension SHALL call `pi.setSessionName(name)` and confirm with a `session_name_update` message.

#### Scenario: Rename from dashboard
- **WHEN** the browser sends a `rename_session` message
- **THEN** the server SHALL forward it to the correct extension connection
- **AND** the extension SHALL call `pi.setSessionName(name)`
- **AND** the extension SHALL send a `session_name_update` back to confirm

### Requirement: Inline rename UI in SessionHeader
The SessionHeader SHALL display the session name with a pencil icon button. Clicking the icon or double-clicking the name SHALL activate an inline text input for editing.

#### Scenario: Activate rename via pencil icon
- **WHEN** user clicks the pencil icon next to the session name
- **THEN** the name SHALL become an editable text input pre-filled with the current name

#### Scenario: Activate rename via double-click
- **WHEN** user double-clicks on the session name text
- **THEN** the name SHALL become an editable text input pre-filled with the current name

#### Scenario: Confirm rename
- **WHEN** user presses Enter in the rename input
- **THEN** a `rename_session` message SHALL be sent with the new name
- **AND** the input SHALL revert to display mode

#### Scenario: Cancel rename
- **WHEN** user presses Escape in the rename input
- **THEN** the input SHALL revert to display mode without sending any message

#### Scenario: Empty name
- **WHEN** user confirms an empty or whitespace-only name
- **THEN** the name SHALL be treated as unset (sent as empty string or undefined)

### Requirement: Inline rename in SessionSidebar
The SessionSidebar SHALL support renaming via double-click on the session name.

#### Scenario: Double-click rename in sidebar
- **WHEN** user double-clicks on a session name in the sidebar
- **THEN** the name SHALL become an editable inline input
- **AND** Enter confirms, Escape cancels (same as SessionHeader)

### Requirement: Server persists session name
The server SHALL persist the session name in the database and include it in session data sent to browsers.

#### Scenario: Name persisted on update
- **WHEN** a `session_name_update` message is received from extension
- **THEN** the server SHALL update the session's name in the database
- **AND** broadcast a `session_updated` message with the new name to all subscribed browsers

#### Scenario: Name available on browser connect
- **WHEN** a browser connects and receives the session list
- **THEN** each session SHALL include its `name` field if set

### Requirement: Auto-name from attached proposal
When a proposal is attached to a session and the session's `name` field is empty or undefined, the server SHALL automatically set `session.name` to the proposal name and send a `rename_session` message to the extension.

#### Scenario: Session auto-named on proposal attach
- **WHEN** proposal `"add-auth"` is attached to session with `name = undefined`
- **THEN** the server SHALL set `session.name = "add-auth"`
- **AND** send `rename_session` to the extension with `name: "add-auth"`
- **AND** broadcast `session_updated` with both `attachedProposal: "add-auth"` and `name: "add-auth"`

#### Scenario: Session name not overwritten on attach
- **WHEN** proposal `"add-auth"` is attached to session with `name = "my work"`
- **THEN** the server SHALL NOT change `session.name`

#### Scenario: Detach does not revert auto-name
- **WHEN** a proposal is detached from a session whose name was auto-set to the proposal name
- **THEN** `session.name` SHALL remain as the proposal name

### Requirement: Inline rename removed from SessionCard
Inline rename via double-click on the session name in SessionCard SHALL be removed. Rename SHALL remain available in SessionHeader and SessionSidebar.

#### Scenario: Double-click does nothing
- **WHEN** user double-clicks session name in SessionCard
- **THEN** no rename input SHALL appear

