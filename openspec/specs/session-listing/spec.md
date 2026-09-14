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

### Requirement: Sessions snapshot replaces client state atomically

The browser message handler (`useMessageHandler`) SHALL handle `sessions_snapshot` by REPLACING the `sessions` Map, the `sessionOrderMap` Map and the `archivedCountByCwd` map with the payload contents. It SHALL NOT merge with existing state. `payload.sessions` SHALL never contain archived sessions.

After replacement, ids that were present in the previous `sessions` Map but are absent from `payload.sessions` SHALL no longer be in `sessions`. Cwds that were present in the previous `sessionOrderMap` but are absent from `payload.orders` SHALL no longer be in `sessionOrderMap`.

#### Scenario: Stale session is dropped on snapshot
- **GIVEN** the client has `sessions` containing id "stale-x" with status "active" from a previous server lifetime
- **WHEN** a `sessions_snapshot` arrives whose `sessions` array does NOT include id "stale-x"
- **THEN** after the message is processed, `sessions.has("stale-x")` SHALL be `false`

#### Scenario: Snapshot replaces sessionOrderMap completely
- **GIVEN** the client has `sessionOrderMap` with entry `{ "/repoA": ["a","b"] }` from a previous server lifetime
- **WHEN** a `sessions_snapshot` arrives with `orders: { "/repoB": ["c"] }`
- **THEN** after the message is processed, `sessionOrderMap.get("/repoA")` SHALL be `undefined`
- **AND** `sessionOrderMap.get("/repoB")` SHALL equal `["c"]`

#### Scenario: Snapshot does not silently merge over fresh ids
- **GIVEN** the snapshot payload contains an updated `DashboardSession` for id "live-y" with status "ended"
- **WHEN** the client previously had id "live-y" with status "active"
- **THEN** after processing, `sessions.get("live-y").status` SHALL equal `"ended"`

#### Scenario: Page merges and appends order
- **GIVEN** the client holds `sessionOrderMap.get("/repoA")` equal to `["a","b"]` and sessions `a`, `b`
- **WHEN** a `sessions_page_result { cwd: "/repoA", sessions: [c, d, b], order: ["c","d","b"], hasMore: false }` arrives
- **THEN** `sessions` SHALL contain `a`, `b`, `c`, `d`
- **AND** `sessionOrderMap.get("/repoA")` SHALL equal `["a","b","c","d"]`

#### Scenario: Paged sessions are discarded by the next snapshot
- **GIVEN** the client merged paged session `old-z` for `/repoA`
- **WHEN** a `sessions_snapshot` arrives that does not include `old-z`
- **THEN** `sessions.has("old-z")` SHALL be `false`

#### Scenario: session_archived deletes the id
- **GIVEN** the client has `sessions` containing id "old-z"
- **WHEN** `session_archived { sessionId: "old-z", cwd: "/repoA", count: 6 }` arrives
- **THEN** `sessions.has("old-z")` SHALL be `false` and `archivedCountByCwd["/repoA"]` SHALL be `6`

#### Scenario: Snapshot replaces archived counts
- **GIVEN** the client has `archivedCountByCwd = { "/repoA": 5 }`
- **WHEN** a `sessions_snapshot` arrives with `archivedCountByCwd: { "/repoB": 312 }`
- **THEN** after processing, `/repoA` SHALL have no archived count and `/repoB` SHALL have `312`

### Requirement: A session that is ended always has an end timestamp
Every entry point that places a session into the session map SHALL guarantee that
a session whose `status` is `"ended"` carries an `endedAt`. This includes the
restore path used to rebuild sessions from disk, not only the update and
unregister paths.

#### Scenario: Ending without an explicit timestamp
- **WHEN** a session's `status` is set to `"ended"` and no `endedAt` is supplied
- **THEN** the resulting record SHALL carry an `endedAt`

#### Scenario: Restoring an ended session from disk
- **WHEN** a session is restored into the session map with `status: "ended"` and no `endedAt`
- **THEN** the stored record SHALL carry an `endedAt`
- **AND** the guarantee SHALL NOT depend on the caller having supplied one

#### Scenario: An explicit timestamp is preserved
- **WHEN** a caller ends or restores a session and supplies an `endedAt`
- **THEN** that value SHALL be kept unchanged

### Requirement: End timestamps are derived from evidence
When the server **directly witnesses** a session ending — an explicit end signal
or a user-initiated termination — the time of that event SHALL be recorded as
`endedAt`.

Otherwise the ending was not witnessed: a session reconstructed from disk, a
session registered from history and immediately unregistered, **or a session the
server concluded had ended because a heartbeat or grace period expired**. In
those cases `endedAt` SHALL be derived from evidence of when the session was last
active, in this precedence:

1. the session's recorded last activity,
2. the transcript's last-write time,
3. `startedAt`.

The time at which the end was detected or reconstructed SHALL NOT be used.

#### Scenario: Historical session reconstructed at boot
- **WHEN** the server rebuilds a historical session whose transcript was last written long ago
- **THEN** the derived `endedAt` SHALL reflect that evidence
- **AND** it SHALL NOT be the time of reconstruction

#### Scenario: No evidence available
- **WHEN** no last-activity evidence can be determined for a reconstructed session
- **THEN** `startedAt` SHALL be used as the fallback

#### Scenario: Boot normalisation uses the same rule
- **WHEN** the server normalises a restored session that is not `"ended"` into `"ended"` at boot
- **THEN** it SHALL derive `endedAt` by the same evidence-based rule rather than the current time

#### Scenario: A witnessed ending records the witnessed time
- **WHEN** the server directly witnesses a running session end
- **THEN** `endedAt` SHALL be the time of that ending
- **AND** it SHALL NOT be replaced by an older last-activity value

#### Scenario: A timeout-inferred ending uses evidence, not detection time
- **WHEN** the server concludes a session ended because a heartbeat or grace period expired
- **THEN** `endedAt` SHALL be derived from the session's last activity
- **AND** it SHALL NOT be the time the expiry was detected

#### Scenario: Precedence when both evidence sources exist and disagree
- **WHEN** a reconstructed session has both a recorded last activity and a differing transcript last-write time
- **THEN** the recorded last activity SHALL be used

#### Scenario: History registered then immediately unregistered
- **WHEN** historical sessions are registered and immediately unregistered while a directory is added
- **THEN** each SHALL receive an evidence-derived `endedAt` rather than the current time

#### Scenario: Reconstructing a session must not disturb stored order
- **WHEN** sessions are reconstructed into the session map at boot
- **THEN** supplying their `endedAt` SHALL NOT emit session-reordering side effects for records already present in the stored per-directory order

### Requirement: Ended-tier seeding uses the best known end time
Ended sessions seeded into per-directory order SHALL be ordered by their best
known end time — the observed end where one exists, otherwise the evidence-derived
value — rather than by when they started.

#### Scenario: A long-running session that ended recently
- **WHEN** ended ids absent from the stored order are seeded, and one session started earliest but ended most recently
- **THEN** it SHALL be seeded ahead of sessions that started later but ended earlier

#### Scenario: Stored order is authoritative
- **WHEN** an ended id is already present in the stored per-directory order
- **THEN** supplying its `endedAt` SHALL NOT change its position

### Requirement: Liveness is determined by status, not by the end timestamp
Whether a session is live SHALL be determined by its `status`. Code SHALL NOT
infer liveness from the presence or absence of `endedAt`.

#### Scenario: A record missing its end timestamp is not live
- **WHEN** a record has `status: "ended"` and no `endedAt`
- **THEN** it SHALL NOT be reported as live
- **AND** it SHALL be listed in the ended tier

#### Scenario: A live session has no end timestamp
- **WHEN** a session is running and has never ended
- **THEN** it SHALL have no `endedAt`
- **AND** the absence SHALL NOT be treated as a defect

### Requirement: A transitional ended state carries a truthful timestamp
Where a session is normalised to `"ended"` as a step toward resuming it, and the
resume does not proceed, the record SHALL be left with an `endedAt` derived by
the evidence rule rather than the moment of normalisation.

#### Scenario: Auto-resume abandoned after normalisation
- **WHEN** a zombie session is normalised to `"ended"` to drive the resume flow
- **AND** the resume does not proceed because the session has no session file
- **THEN** the record SHALL carry an evidence-derived `endedAt`
- **AND** that value SHALL NOT be the time the normalisation ran

### Requirement: Browser pages older ended sessions on demand

In this requirement `cwd` on `sessions_page` / `sessions_page_result` and the keys of `endedTotals` denote the session group key the sidebar already groups by (pinned directory, else worktree main path, else session cwd), so a worktree session pages within its parent group. The client SHALL render a folder group for every group key that has a non-zero `endedTotals` entry even when it holds no session for that cwd (a stub group whose only content is the ended expander). When a folder group's ended list is expanded and `endedTotals[cwd]` exceeds the number of ended sessions the client holds for that cwd, the client SHALL request `sessions_page { cwd, offset }` where `offset` is the number of non-window (paged) ended sessions it already holds for that cwd, and SHALL issue at most one page request per cwd at a time (released on reply, on a 15-second timeout, or when the socket opens). The server SHALL reply to that browser only with `sessions_page_result { cwd, sessions, order, hasMore }` containing the next batch, taken at `offset` from the cwd's ended sequence (persisted order restricted to ended ids, then ended ids without a persisted position by `startedAt` descending) with the snapshot-window ids excluded, and `hasMore` true when further entries remain. The client SHALL ignore order ids it does not hold when applying any order, and SHALL keep held ids absent from an incoming `sessions_reordered` at the tail rather than evicting them.

#### Scenario: Expanding the ended list pages in the next batch
- **GIVEN** a cwd group with `endedTotal` of 500 and 20 ended sessions held by the client
- **WHEN** the user expands the ended list
- **THEN** the client SHALL send one `sessions_page` for that cwd
- **AND** on `sessions_page_result` the ended list SHALL grow by the page's sessions in order
- **AND** a "more" affordance SHALL be shown while `endedTotals[cwd]` exceeds the ended sessions held for that cwd

#### Scenario: Stub group for a cwd outside the window
- **GIVEN** a snapshot with `endedTotals["/old/wt"]` of 3 and no session for `/old/wt`
- **WHEN** the sidebar renders
- **THEN** a folder group for `/old/wt` SHALL be shown with an ended expander labelled from `endedTotals`
- **AND** expanding it SHALL send `sessions_page { cwd: "/old/wt", offset: 0 }

#### Scenario: Sequential paging per cwd
- **WHEN** a page request for a cwd is in flight
- **THEN** a further expand on the same cwd SHALL NOT send a second `sessions_page` until the first reply arrives

#### Scenario: No paging when everything is held
- **GIVEN** a cwd group whose `endedTotal` equals the ended sessions the client holds
- **WHEN** the user expands the ended list
- **THEN** no `sessions_page` SHALL be sent

#### Scenario: Unknown ids in an order are ignored
- **WHEN** a `sessions_reordered` or `sessions_page_result` order contains an id the client does not hold
- **THEN** the client SHALL apply the order without that id and without error

#### Scenario: Live reorder keeps paged ids
- **GIVEN** the client holds paged ended ids `p1`, `p2` for `/repoA` after `a`, `b`
- **WHEN** a `sessions_reordered { cwd: "/repoA", order: ["b","a"] }` arrives
- **THEN** `sessionOrderMap.get("/repoA")` SHALL equal `["b","a","p1","p2"]`

#### Scenario: Ended-count stays live between snapshots
- **GIVEN** `endedTotals["/repoA"]` of 2
- **WHEN** a `session_updated` transitions a held `/repoA` session to `ended`
- **THEN** the expander label for `/repoA` SHALL reflect 3

### Requirement: Client reconciles missing OpenSpec entries for rendered cwds

The client SHALL compute the set of cwds for which it renders a non-ended session card, a pinned folder card, or the selected-session pane (any status), and for each such cwd that has no settled entry in its OpenSpec map (no entry, or only a `pending: true` placeholder) and no in-flight request, it SHALL send `openspec_get` with a fresh `requestId`. The reconciliation SHALL run when the socket opens (every reconnect), when a `sessions_snapshot` is applied, and whenever the rendered cwd set or the OpenSpec map changes. At most one request per cwd SHALL be in flight; the in-flight mark SHALL be released on a reply with `final: true`, on a 15-second timeout, or when the socket opens. An `openspec_get_result` SHALL be applied to the OpenSpec map exactly as an `openspec_update` for its cwd.

#### Scenario: Card renders for a cwd whose openspec frame never arrived
- **GIVEN** a non-ended session card is rendered for `/repo/w` and the OpenSpec map has no entry for `/repo/w`
- **WHEN** the reconciliation runs
- **THEN** the client SHALL send exactly one `openspec_get` for `/repo/w`
- **AND** on the `final: true` reply the card's OpenSpec section SHALL render according to the returned readiness

#### Scenario: Ended cards and stub groups do not pull
- **GIVEN** only ended session cards or a stub group are rendered for `/old/wt` and the OpenSpec map has no entry for it
- **WHEN** the reconciliation runs
- **THEN** no `openspec_get` SHALL be sent for `/old/wt`

#### Scenario: One in-flight request per cwd across many cards
- **GIVEN** 5 non-ended session cards rendered for the same cwd with no OpenSpec entry
- **WHEN** the reconciliation runs
- **THEN** exactly one `openspec_get` SHALL be sent for that cwd

#### Scenario: Reconnect re-runs the reconciliation
- **GIVEN** an `openspec_get` was in flight when the socket dropped
- **WHEN** the socket reopens and the snapshot is applied
- **THEN** the in-flight mark SHALL be cleared
- **AND** if the cwd still has no entry the client SHALL send a new `openspec_get` for it

#### Scenario: Timeout releases the in-flight mark
- **GIVEN** an `openspec_get` for `/repo/w` received no `final: true` reply
- **WHEN** 15 seconds elapse
- **THEN** a subsequent reconciliation SHALL be allowed to send a new `openspec_get` for `/repo/w`

#### Scenario: Result is applied like an update
- **WHEN** `openspec_get_result { cwd: "/repo/w", data }` arrives
- **THEN** the OpenSpec map entry for `/repo/w` SHALL equal `data`, exactly as if `openspec_update { cwd: "/repo/w", data }` had arrived
