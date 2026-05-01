## ADDED Requirements

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
