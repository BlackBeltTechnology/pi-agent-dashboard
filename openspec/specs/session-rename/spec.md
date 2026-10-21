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

### Requirement: Automatic topic naming on terminal turn

When automatic naming is enabled, the bridge extension SHALL attempt to name an eligible session by its topic after each terminal turn (`agent_end`), until the first successful name, a permanent lockout, or exhaustion of the session's attempt budget. A session is eligible only when ALL hold: the global `autoNameSessions` preference is true, the session's `nameSource` is neither `"user"` nor `"system"`, the session has no auto-generated name yet, and the session is not permanently stopped. The first successful auto-name SHALL end all further attempts for that session.

Attempts SHALL NOT continue indefinitely. Each attempt that consumes a model completion SHALL spend one unit of a bounded per-session attempt budget; exhausting it SHALL stop naming permanently for that session.

#### Scenario: Eligible session gets named

- **WHEN** a terminal turn ends for a session that is enabled, not user-named, not system-named, not yet auto-named, and not stopped
- **AND** the enough-info gate passes and the model returns a valid title
- **THEN** the bridge SHALL call `pi.setSessionName(title)` and mark `nameSource = "auto"`
- **AND** SHALL NOT attempt naming again for that session

#### Scenario: Feature disabled

- **WHEN** `autoNameSessions` is false
- **THEN** the bridge SHALL NOT call the model on any turn

#### Scenario: Already auto-named

- **WHEN** a session already has an auto-generated name
- **THEN** subsequent terminal turns SHALL NOT trigger another naming attempt

#### Scenario: System-named session is not auto-named

- **WHEN** a session's `nameSource` is `"system"`
- **THEN** terminal turns SHALL NOT trigger a naming attempt

#### Scenario: Attempts are bounded

- **WHEN** a session repeatedly fails to produce an applicable title
- **THEN** the number of naming completions for that session SHALL be bounded by the attempt budget
- **AND** SHALL NOT grow with the number of terminal turns

### Requirement: Enough-info gate

The bridge SHALL apply a two-layer "enough information" gate before naming. A cheap pre-filter SHALL skip, without any model call, a candidate user message that is a pure greeting, is shorter than a configured minimum length, or is a bare slash-command. The pre-filter SHALL evaluate the most recent SUBSTANTIVE user message from the advancing transcript window, not permanently the first user message.

Past the pre-filter, the summarizer prompt SHALL instruct the model to emit the sentinel `NULL` when no topic is inferable. The bridge SHALL treat a `NULL` or over-long response as "not yet" and retry on a later turn while attempt budget remains.

An EMPTY response SHALL NOT be treated the same as `NULL`: an empty or truncated completion indicates the model could not emit a title under the requested output cap, and SHALL be classified as starvation rather than as "no topic yet".

#### Scenario: Greeting is skipped without a model call

- **WHEN** the candidate user message is `"hi"` (or matches the greeting set / is below the minimum length / is a bare slash-command)
- **THEN** the bridge SHALL NOT call the model and SHALL wait for a later turn

#### Scenario: Model returns NULL sentinel

- **WHEN** the model responds with `NULL` (or an over-length reply) for the current window
- **THEN** the bridge SHALL NOT set a name and SHALL retry on a later terminal turn while budget remains

#### Scenario: Empty response is not a NULL

- **WHEN** the model returns an empty response, or the stream is truncated by the output cap
- **THEN** the bridge SHALL classify the attempt as starvation
- **AND** SHALL NOT treat it as "no topic yet"

#### Scenario: Substantive turn after a trivial opener

- **WHEN** a session opens with a greeting, then a later turn carries real work and the model returns a valid title
- **THEN** the bridge SHALL name the session on that later turn

### Requirement: Auto-naming uses the naming role in-process

The bridge SHALL resolve the naming model to a concrete `provider/modelId` via the role resolver — consulting the `naming` role first and falling back to `@fast` when `naming` is unassigned — and call the model in-process using pi-ai's stream primitive and the model registry's credential resolution. It SHALL NOT route the naming request through the dashboard server's model-proxy.

#### Scenario: Naming role resolved and called directly

- **WHEN** the naming model resolves to an authenticatable model
- **THEN** the bridge SHALL generate the title in-process without a request to the dashboard server

#### Scenario: Fallback to the fast role

- **WHEN** the `naming` role is unassigned
- **THEN** the bridge SHALL resolve `@fast`
- **AND** the resolved reference SHALL equal the pre-change resolution

### Requirement: Manual rename permanently locks out auto-naming
A name change neither the bridge nor the dashboard originated programmatically — a user-initiated dashboard rename (UI or the REST rename endpoint) or an in-pi rename — SHALL set `nameSource = "user"` and permanently prevent auto-naming for that session. An auto-generated name SHALL set `nameSource = "auto"` and stop the naming loop but SHALL NOT count as a user lock; a later manual rename SHALL still escalate to `"user"`. A rename the dashboard applies programmatically (attach auto-rename, detach auto-revert, trusted-plugin rename) SHALL NOT set `nameSource = "user"`.

#### Scenario: Dashboard rename locks out auto
- **WHEN** the user renames a session from the dashboard
- **THEN** `nameSource` SHALL become `"user"` and no auto-naming SHALL occur thereafter

#### Scenario: REST rename locks out auto without a connected bridge
- **WHEN** a session is renamed via the REST rename endpoint while no bridge is connected
- **THEN** the server SHALL record `nameSource = "user"`

#### Scenario: In-pi rename locks out auto
- **WHEN** the session name changes inside pi and neither the bridge nor the dashboard originated that change
- **THEN** `nameSource` SHALL become `"user"` and no auto-naming SHALL occur thereafter

#### Scenario: Manual rename after an auto-name
- **WHEN** a session was auto-named (`nameSource = "auto"`) and the user then renames it
- **THEN** `nameSource` SHALL become `"user"`

#### Scenario: Manual rename after a system rename
- **WHEN** a session was named programmatically (`nameSource = "system"`) and the user then renames it
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

### Requirement: Attach auto-name carries system provenance and detach reverts it
When a proposal is attached to a session and the session's `name` field is empty or undefined, the server SHALL automatically set `session.name` to the proposal name, record `nameSource = "system"`, and send a `rename_session` message tagged with `system` origin to the extension. On detach, a name that was auto-set by the attach (it equals the attached proposal) SHALL be reverted unless the session's `nameSource` is `"user"`.

#### Scenario: Session auto-named on proposal attach
- **WHEN** proposal `"add-auth"` is attached to session with `name = undefined`
- **THEN** the server SHALL set `session.name = "add-auth"` and `nameSource = "system"`
- **AND** send `rename_session` to the extension with `name: "add-auth"` and `system` origin
- **AND** broadcast `session_updated` with both `attachedProposal: "add-auth"` and `name: "add-auth"`

#### Scenario: Session name not overwritten on attach
- **WHEN** proposal `"add-auth"` is attached to session with `name = "my work"`
- **THEN** the server SHALL NOT change `session.name`

#### Scenario: Detach reverts an attach-set name
- **WHEN** a proposal is detached from a session whose name was auto-set to the proposal name and whose `nameSource` is not `"user"`
- **THEN** `session.name` SHALL be cleared and `nameSource` and its witness SHALL be cleared
- **AND** the server SHALL send `rename_session` with an empty name and `system` origin

#### Scenario: Detach keeps a user-owned name equal to the proposal
- **WHEN** a proposal is detached from a session whose name equals the proposal name but whose `nameSource` is `"user"`
- **THEN** `session.name` SHALL remain unchanged and no `rename_session` SHALL be sent

### Requirement: Dashboard programmatic renames record `system` provenance

Every rename the server applies programmatically — the attach auto-rename (browser, REST, and auto-attach on a detected change), the detach auto-revert, and a trusted plugin's rename — SHALL be sent to the extension tagged with `system` origin. In the same update that sets the name, the server SHALL record `nameSource = "system"` and the applied name as the provenance witness for a non-empty name, and SHALL clear a `system` provenance and its witness for an empty name. The server SHALL NOT change a `user` provenance on a programmatic rename. A user-initiated rename SHALL NOT be tagged `system`.

#### Scenario: Attach auto-rename records system
- **WHEN** proposal `"add-auth"` is attached to a session with no name
- **THEN** the server SHALL set `name = "add-auth"`, `nameSource = "system"` and witness `"add-auth"`
- **AND** the `rename_session` sent to the extension SHALL carry `system` origin

#### Scenario: Auto-attach on detected change records system
- **WHEN** the server auto-attaches a detected change and auto-renames the session
- **THEN** `nameSource` SHALL be `"system"` and the rename SHALL carry `system` origin

#### Scenario: Plugin rename records system
- **WHEN** a trusted plugin renames a session
- **THEN** `nameSource` SHALL be `"system"` and the rename SHALL carry `system` origin

#### Scenario: User rename is never tagged system
- **WHEN** the user renames a session from the dashboard or via the REST rename endpoint
- **THEN** the `rename_session` sent to the extension SHALL NOT carry `system` origin

#### Scenario: Programmatic rename does not downgrade user
- **GIVEN** a session with `nameSource = "user"`
- **WHEN** a programmatic rename is applied
- **THEN** `nameSource` SHALL remain `"user"`

### Requirement: Server rejects a stale `user` claim for a witnessed name

When the server receives a `session_name_update` from the bridge claiming `nameSource: "user"` while the session's recorded provenance is `auto` or `system`, and the claimed name equals (after pi's session-name sanitization, applied identically on server and bridge) the witness name that provenance was recorded for, the server SHALL keep the recorded provenance and SHALL still apply the name. This SHALL hold even when a provenance-less name update for the same name arrived first. A `user` claim for any other name SHALL be applied and SHALL clear the witness. A bridge claim of `nameSource: "auto"` while the recorded provenance is `system` or `user` SHALL be dropped entirely: neither the name nor the provenance SHALL change.

#### Scenario: Old bridge echo of a system name is rejected
- **GIVEN** a session with `nameSource = "system"` witnessed for `"add-x"`
- **WHEN** a `session_name_update{name:"add-x", nameSource:"user"}` arrives
- **THEN** `nameSource` SHALL remain `"system"`

#### Scenario: Restart relabel of an auto-name is rejected
- **GIVEN** a session with `nameSource = "auto"` witnessed for `"Fix login flow"`
- **WHEN** a `session_name_update{name:"Fix login flow", nameSource:"user"}` arrives after a plain name update with the same name
- **THEN** `nameSource` SHALL remain `"auto"`

#### Scenario: Auto claim does not override a system name
- **GIVEN** a session with `nameSource = "system"`
- **WHEN** a `session_name_update{name:"Some title", nameSource:"auto"}` arrives
- **THEN** `nameSource` SHALL remain `"system"`
- **AND** `session.name` SHALL NOT change

#### Scenario: Genuine rename is accepted
- **GIVEN** a session with `nameSource = "auto"` witnessed for `"Fix login flow"`
- **WHEN** a `session_name_update{name:"my name", nameSource:"user"}` arrives
- **THEN** `nameSource` SHALL become `"user"` and the witness SHALL be cleared
