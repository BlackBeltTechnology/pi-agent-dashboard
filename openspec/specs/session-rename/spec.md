## Purpose

Give each session a display name — a user rename (from the dashboard UI or in-pi), with a cwd-basename fallback when unset. The bridge polls the pi session name, the server persists it, and an attached proposal can auto-name an unnamed session.
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

### Requirement: Automatic topic naming on terminal turn
When automatic naming is enabled, the bridge extension SHALL attempt to name an eligible session by its topic after each terminal turn (`agent_end`). A session is eligible only when ALL hold: the global `autoNameSessions` preference is true, the session's `nameSource` is not `"user"`, and the session has no auto-generated name yet. The first successful auto-name SHALL end all further attempts for that session.

#### Scenario: Eligible session gets named
- **WHEN** a terminal turn ends for a session that is enabled, not user-named, and not yet auto-named
- **AND** the enough-info gate passes and the model returns a valid title
- **THEN** the bridge SHALL call `pi.setSessionName(title)` and mark `nameSource = "auto"`
- **AND** SHALL NOT attempt naming again for that session

#### Scenario: Feature disabled
- **WHEN** `autoNameSessions` is false
- **THEN** the bridge SHALL NOT attempt naming on any turn

#### Scenario: Already auto-named
- **WHEN** a session already has an auto-generated name
- **THEN** subsequent terminal turns SHALL NOT trigger another naming attempt

### Requirement: Enough-info gate
The bridge SHALL apply a two-layer "enough information" gate before naming. A cheap pre-filter SHALL skip, without any model call, a first user message that is a pure greeting, is shorter than a configured minimum length, or is a bare slash-command. Past the pre-filter, the summarizer prompt SHALL instruct the model to emit the sentinel `NULL` when no topic is inferable; the bridge SHALL treat a `NULL`, empty, or over-long response as "not yet" and retry on a later turn.

#### Scenario: Greeting is skipped without a model call
- **WHEN** the first user message is `"hi"` (or matches the greeting set / is below the minimum length / is a bare slash-command)
- **THEN** the bridge SHALL NOT call the model and SHALL wait for a later turn

#### Scenario: Model returns NULL sentinel
- **WHEN** the model responds with `NULL` (or empty / over-length) for the current window
- **THEN** the bridge SHALL NOT set a name and SHALL retry on a later terminal turn

#### Scenario: Substantive turn after a trivial opener
- **WHEN** a session opens with a greeting, then a later turn carries real work and the model returns a valid title
- **THEN** the bridge SHALL name the session on that later turn

### Requirement: Auto-naming uses the fast role in-process
The bridge SHALL resolve `@fast` to a concrete `provider/modelId` via the role resolver and call the model in-process using pi-ai's stream primitive and the model registry's credential resolution. It SHALL NOT route the naming request through the dashboard server's model-proxy.

#### Scenario: Fast role resolved and called directly
- **WHEN** `@fast` resolves to an authenticatable model
- **THEN** the bridge SHALL generate the title in-process without a request to the dashboard server

### Requirement: Manual rename permanently locks out auto-naming
A name change the bridge did not originate — a dashboard-initiated rename or an in-pi rename — SHALL set `nameSource = "user"` and permanently prevent auto-naming for that session. An auto-generated name SHALL set `nameSource = "auto"` and stop the naming loop but SHALL NOT count as a user lock; a later manual rename SHALL still escalate to `"user"`.

#### Scenario: Dashboard rename locks out auto
- **WHEN** the user renames a session from the dashboard
- **THEN** `nameSource` SHALL become `"user"` and no auto-naming SHALL occur thereafter

#### Scenario: In-pi rename locks out auto
- **WHEN** the session name changes inside pi and the bridge did not originate that change
- **THEN** `nameSource` SHALL become `"user"` and no auto-naming SHALL occur thereafter

#### Scenario: Manual rename after an auto-name
- **WHEN** a session was auto-named (`nameSource = "auto"`) and the user then renames it
- **THEN** `nameSource` SHALL become `"user"`

### Requirement: Auto-naming errors are silent on the name and surfaced as a notification
When auto-naming fails — `@fast` unconfigured, resolved to an OAuth-only provider the bridge cannot authenticate, or a model/parse error — the bridge SHALL leave the session name unchanged and SHALL emit a single notification (`auto_name_error`) carrying a human-readable reason, which the server SHALL forward to subscribers as a client toast. Hard configuration errors SHALL stop further attempts; transient model errors MAY retry on a later turn. The bridge SHALL NOT crash the session on any naming error.

#### Scenario: Fast role not configured
- **WHEN** `@fast` has no assigned model
- **THEN** the bridge SHALL not change the name, SHALL emit one `auto_name_error`, and SHALL stop attempting

#### Scenario: Fast role is OAuth-only and unauthable
- **WHEN** `@fast` resolves to an OAuth-only provider the bridge cannot authenticate
- **THEN** the bridge SHALL take the hard-error branch (one `auto_name_error`, stop) rather than crash or loop

#### Scenario: Transient model error
- **WHEN** the model call throws a transient error
- **THEN** the bridge SHALL leave the name unchanged and MAY retry on a later terminal turn

