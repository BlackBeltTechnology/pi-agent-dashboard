## Purpose

Enables discovering and listing pi sessions from local session files via the bridge extension, creating dashboard records for previously unknown sessions.

## Requirements

### Requirement: List pi sessions via bridge
The bridge extension SHALL handle `list_sessions` messages by calling pi's `SessionManager.list(cwd)` static method and returning the results as a `sessions_list` message.

#### Scenario: List sessions for a directory
- **WHEN** the bridge receives a `list_sessions` message with a `cwd` field
- **THEN** it SHALL call `SessionManager.list(cwd)` and return a `sessions_list` message with session metadata for all sessions in that directory

#### Scenario: Session metadata includes required fields
- **WHEN** `SessionManager.list(cwd)` returns session info
- **THEN** each entry in the `sessions_list` SHALL include: `id`, `path` (JSONL file path), `cwd`, `name` (if set), `parentSessionPath` (if forked), `created`, `modified`, `messageCount`, and `firstMessage`

#### Scenario: No sessions found
- **WHEN** `SessionManager.list(cwd)` returns an empty array
- **THEN** the bridge SHALL return a `sessions_list` with an empty `sessions` array

#### Scenario: SessionManager.list fails
- **WHEN** `SessionManager.list(cwd)` throws an error
- **THEN** the bridge SHALL return a `sessions_list` with an empty `sessions` array (graceful degradation)

### Requirement: Server creates records for undiscovered sessions
When the server receives a `sessions_list` from the bridge, it SHALL create in-memory session records for any pi sessions not already in the session manager.

#### Scenario: New session discovered from pi listing
- **WHEN** the `sessions_list` contains a session ID not present in the session manager
- **THEN** the server SHALL register a new record with: `id` = pi session ID, `cwd` from listing, `name` from listing, `sessionFile` = path from listing, then immediately unregister it (setting `status = "ended"`)

#### Scenario: Existing session in listing
- **WHEN** the `sessions_list` contains a session ID already present in the session manager
- **THEN** the server SHALL NOT overwrite the existing record (dashboard data takes precedence)

#### Scenario: Session file path updated for existing session
- **WHEN** the `sessions_list` contains a known session ID but with a different `sessionFile`
- **THEN** the server SHALL update the `sessionFile` and `sessionDir` fields (file may have been moved)

### Requirement: Browser requests session listing
The browser SHALL be able to request a session listing for a specific cwd. The server SHALL forward the request to any connected bridge for that cwd and return the results.

#### Scenario: Browser requests session list
- **WHEN** the browser sends a `list_sessions` message with a `cwd`
- **THEN** the server SHALL forward the request to a connected bridge extension whose session cwd matches, and relay the `sessions_list` response back to the browser

#### Scenario: No bridge connected for cwd
- **WHEN** the browser requests sessions for a cwd but no bridge is connected for that directory
- **THEN** the server SHALL return sessions from the in-memory registry filtered by cwd prefix match
### Requirement: Session cards display flow activity badge
The `SessionCard` component SHALL render a `FlowActivityBadge` below the `OpenSpecActivityBadge` when the session has an active or recently completed flow.

#### Scenario: Flow badge rendered for active flow
- **WHEN** a session has `activeFlowName` set
- **THEN** the session card SHALL display a flow activity badge with the flow name and progress

#### Scenario: No badge without flow
- **WHEN** a session has no `activeFlowName`
- **THEN** no flow activity badge SHALL be rendered

### Requirement: Session cards display flow launcher section
The `SessionCard` component SHALL render a flow launcher section when the session has available flow commands detected from the commands list. The section SHALL be labeled "Flows:" to distinguish it from other sections.

#### Scenario: Flow launcher rendered
- **WHEN** the session's commands list contains flow commands
- **THEN** the session card SHALL display a "Flows:" labeled section with a "▶ Run Flow..." button below the OpenSpec actions

#### Scenario: No launcher without flows
- **WHEN** the session has no flow commands in its commands list
- **THEN** no flow launcher section SHALL be rendered

### Requirement: OpenSpec attach section labeled
The `SessionOpenSpecActions` component SHALL display an "OpenSpec:" label before the attach button to distinguish it from other card sections.

#### Scenario: OpenSpec label visible
- **WHEN** OpenSpec changes are available
- **THEN** the session card SHALL show "OpenSpec:" followed by the "Attach change..." button

### Requirement: OpenSpec attach uses searchable dialog
The OpenSpec attach button SHALL open a `SearchableSelectDialog` instead of a native `<select>` dropdown. Each change option SHALL display the change name, lifecycle state description (Planning / Ready to implement / Implementing — N/M tasks / Complete — N/M tasks), artifact list, and a status badge.

#### Scenario: Open attach picker
- **WHEN** the user clicks "Attach change..."
- **THEN** a searchable dialog SHALL appear listing all available changes with descriptions

#### Scenario: Filter changes by typing
- **WHEN** the user types in the search field
- **THEN** the list SHALL filter to changes whose name or description contains the query

#### Scenario: Change description shows lifecycle detail
- **WHEN** a change is in "IMPLEMENTING" state with 3/12 tasks and artifacts [proposal, design, specs, tasks]
- **THEN** the description SHALL show "Implementing — 3/12 tasks · proposal, design, specs, tasks"

### Requirement: DashboardSession includes flow fields
The `DashboardSession` type SHALL include optional fields: `activeFlowName?: string`, `flowAgentsDone?: number`, `flowAgentsTotal?: number`, `flowStatus?: "running" | "success" | "error" | "aborted"`.

#### Scenario: Flow fields in session updates
- **WHEN** the server processes flow events for a session
- **THEN** the `session_updated` message SHALL include the flow fields

### Requirement: DashboardSession tracks last-activity timestamp

The `DashboardSession` type SHALL include an optional field `lastActivityAt: number` (epoch ms) representing the most recent moment any activity event was received for that session. The field is server-managed; bridges SHALL NOT send it.

#### Scenario: Activity event updates the timestamp

- **WHEN** the server receives an `event_forward` message whose `eventType` is on the activity-event allowlist (e.g. `message_start`, `tool_execution_start`, `turn_end`, `prompt_send`, `flow_started`, `bash_output`)
- **THEN** the server SHALL set `session.lastActivityAt = Date.now()`

#### Scenario: Non-activity event does not update the timestamp

- **WHEN** the server receives an `event_forward` message whose `eventType` is excluded from the allowlist (e.g. `process_metrics`, `model_select`, `git_info_update`, `ui_modules_list`, `ext_ui_decorator`)
- **THEN** the server SHALL NOT modify `session.lastActivityAt`

### Requirement: Last-activity broadcast is debounced per session

Server-side broadcasts of `lastActivityAt` updates SHALL be throttled to at most one broadcast per session per 30-second window. In-memory state SHALL update on every activity event regardless of the throttle.

#### Scenario: First activity event broadcasts immediately

- **WHEN** an activity event is received for a session that has not broadcast a `lastActivityAt` update in the past 30s
- **THEN** the server SHALL broadcast a `session_updated` message containing the new `lastActivityAt`

#### Scenario: Subsequent activity within 30s does not re-broadcast

- **WHEN** an activity event is received for a session less than 30s after its last `lastActivityAt` broadcast
- **THEN** the server SHALL update `session.lastActivityAt` in memory but SHALL NOT broadcast a `session_updated` message for that change alone
- **AND** a concurrent broadcast for an unrelated field change (e.g. status, tokens) MAY include the latest `lastActivityAt`

### Requirement: Last-activity is seeded from events.jsonl at server start

When the server discovers existing sessions on startup, it SHALL seed each session's `lastActivityAt` from the modification time of that session's `events.jsonl` file. If the file is missing or unreadable, `lastActivityAt` SHALL remain undefined and the badge SHALL fall back to `startedAt`.

#### Scenario: Existing session with readable events.jsonl

- **WHEN** the server boots and discovers a session whose `events.jsonl` was last written 4 hours ago
- **THEN** that session's `lastActivityAt` SHALL be set to that file's mtime (≈ now − 4h)

#### Scenario: Session with missing events.jsonl

- **WHEN** the server boots and discovers a session whose `events.jsonl` cannot be stat'd
- **THEN** `lastActivityAt` SHALL remain undefined and the scanner SHALL NOT fail

### Requirement: Session card badge renders relative time since last activity

The session card "X ago" header badge SHALL render relative time computed from the most recent of the session's activity-related timestamps, using the precedence: ended sessions display time since `endedAt`; active sessions display time since `lastActivityAt`, falling back to `startedAt` only when `lastActivityAt` is undefined.

#### Scenario: Active session with recent activity

- **WHEN** a session has `status: "active"` and `lastActivityAt` set to 90 seconds ago
- **THEN** the badge SHALL render "1m" (or equivalent formatting)

#### Scenario: Active session with no activity yet

- **WHEN** a session has `status: "active"` and `lastActivityAt` is undefined
- **THEN** the badge SHALL render relative time computed from `startedAt`

#### Scenario: Ended session

- **WHEN** a session has `status: "ended"` and `endedAt` set
- **THEN** the badge SHALL render relative time computed from `endedAt`, regardless of `lastActivityAt`

### Requirement: Session card badge tooltip shows original spawn time

The header badge SHALL expose the session's original `startedAt` as a native browser tooltip (`title` attribute), formatted as a localized human-readable absolute timestamp prefixed with `"Started "`.

#### Scenario: Hover reveals spawn time

- **WHEN** the user hovers the badge on a session that started yesterday at 12:13
- **THEN** the browser SHALL display a tooltip containing `"Started "` followed by a localized representation of that timestamp
