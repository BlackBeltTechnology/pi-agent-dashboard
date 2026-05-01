## Purpose

Enables per-directory session ordering with persistence, auto-placement rules, and drag-and-drop reordering via the browser client.

## Requirements

### Requirement: Persist session order per directory
The server SHALL maintain an ordered list of session IDs per cwd. The order SHALL be persisted in the state JSON file under a `sessionOrder` key mapping cwd strings to session ID arrays.

#### Scenario: Order persists across server restarts
- **WHEN** session order is set for a cwd and the server restarts
- **THEN** the order SHALL be restored from the state JSON file

#### Scenario: Empty order for unknown cwd
- **WHEN** no order has been set for a cwd
- **THEN** `getOrder(cwd)` SHALL return an empty array

### Requirement: Auto-place new sessions at the beginning
When a new session registers, the server SHALL prepend its ID to the front of the order array for its cwd.

#### Scenario: New session prepended
- **WHEN** a session registers with cwd `/project` and the current order is `["s1", "s2"]`
- **THEN** the order SHALL become `["s3", "s1", "s2"]`

#### Scenario: First session in a cwd
- **WHEN** a session registers with a cwd that has no existing order
- **THEN** the order SHALL be `["s1"]`

### Requirement: Auto-place forked sessions after parent
When a fork is initiated, the server SHALL record a pending fork entry with the parent session ID and cwd. When the new session registers in that cwd, it SHALL be inserted immediately after the parent session in the order array.

#### Scenario: Fork inserts after parent
- **WHEN** session "s2" is forked from session "s1" in cwd `/project` with order `["s1", "s3"]`
- **THEN** the order SHALL become `["s1", "s2", "s3"]`

#### Scenario: Fork pending entry expires
- **WHEN** a fork is initiated but no new session registers within 30 seconds
- **THEN** the pending fork entry SHALL be discarded
- **AND** if the session registers later, it SHALL be prepended as a normal new session

#### Scenario: Fork parent not in order array
- **WHEN** a fork's parent session ID is not found in the order array
- **THEN** the forked session SHALL be prepended (fallback to new session behavior)

### Requirement: Continued sessions keep position
When a session is resumed with `mode: "continue"`, the server SHALL choose its placement in the cwd's order array based on a **4-way intent contract** combining the `pendingResumeIntents` registry and the `registerReason` field on the `session_register` message:

- **`registerReason: "reattach"`** — bridge auto-reattach after a dashboard restart. Server SHALL apply the configured `reattachPlacement` policy (see "Reattach placement policy applied on register").
- **`"front"`** (registry intent) — move the session id to index 0 of `sessionOrder` regardless of its prior position. Tagged by: Resume button click, REST resume endpoint, and prompt-auto-resume to an ended session (the user is actively interacting). Server SHALL broadcast `sessions_reordered` with the new order.
- **`"keep"`** (registry intent) — leave `sessionOrder` unchanged. The drop position written by an earlier `reorder_sessions` message is the source of truth and MUST NOT be clobbered. Tagged by: drag-to-resume only. Server SHALL NOT broadcast `sessions_reordered` for the transition itself (the drag's `reorder_sessions` already broadcast).
- **No tag and no `registerReason`** — backwards-compatible legacy bridges. Server SHALL preserve the existing layout (no mutation, no broadcast). Equivalent to the old `null` intent.

The `registerReason: "reattach"` signal takes precedence over a `null` registry intent. If both a registry intent (`"front"` or `"keep"`) and `registerReason: "reattach"` are present (e.g. a user clicked Resume mid-flight on a reconnecting session), the registry intent wins because it represents an explicit user action.

Any code path that initiates a user-driven resume MUST call `pendingResumeIntents.record(sessionId, intent)` before triggering the spawn. The `consume(sessionId)` call in the `onChange` ended→alive branch returns `"front" | "keep" | null`.

#### Scenario: Resume button moves id to front
- **WHEN** session "s2" is at position 1 in order `["s0", "s1", "s2"]` and the user clicks the Resume button on "s2"
- **THEN** the registry SHALL be tagged with `intent: "front"` for "s2"
- **AND** after the bridge re-registers, the order SHALL become `["s2", "s0", "s1"]`
- **AND** the server SHALL broadcast `sessions_reordered` with the new order

#### Scenario: REST resume moves id to front
- **WHEN** the browser sends `POST /api/session/s2/resume` against an ended session "s2"
- **THEN** the registry SHALL be tagged with `intent: "front"` for "s2"
- **AND** after the bridge re-registers, the order SHALL move "s2" to index 0
- **AND** the server SHALL broadcast `sessions_reordered`

#### Scenario: Drag-to-resume preserves dropped slot
- **WHEN** the user drags ended session "X" from the ended bucket and drops it between alive sessions "A" and "B" in the same folder
- **THEN** the client SHALL first send `reorder_sessions` with `["A", "X", "B"]`
- **AND** the server SHALL persist that order and broadcast `sessions_reordered`
- **AND** the client SHALL then send `resume_session { sessionId: "X", placement: "keep" }`
- **AND** the server SHALL tag the registry with `intent: "keep"` for "X"
- **AND** when the bridge re-registers "X" and the ended→alive transition fires, the server SHALL NOT mutate `sessionOrder`
- **AND** the order SHALL remain `["A", "X", "B"]` (dropped slot preserved)
- **AND** the server SHALL NOT broadcast `sessions_reordered` for the ended→alive transition

#### Scenario: Resume cycle keeps front placement on each cycle
- **WHEN** session "s1" goes through end → resume-via-button → end → resume-via-button in cwd `/project`
- **THEN** after each user-intent resume tagged `"front"`, the id "s1" SHALL be at index 0 of `sessionOrder`
- **AND** repeated cycles SHALL not cause "s1" to drift to a non-front position

#### Scenario: Bridge auto-reattach with registerReason applies configured policy
- **WHEN** the dashboard server restarts and a still-alive bridge re-registers session "s2" with `registerReason: "reattach"`
- **THEN** the server SHALL apply the configured `reattachPlacement` policy (default `"always"` → `moveToFront(cwd, "s2")` + broadcast `sessions_reordered`)

#### Scenario: Legacy bridge reattach without registerReason preserves layout
- **WHEN** the dashboard server restarts and a legacy bridge (no `registerReason` field) re-registers session "s2"
- **THEN** the server SHALL treat the absence as `registerReason: "spawn"` and apply the existing prepend-or-no-op rule for the session id
- **AND** the server SHALL NOT apply the reattach placement policy

#### Scenario: Re-record overwrites prior intent (last-write-wins)
- **WHEN** the registry is tagged with `intent: "keep"` for session "X" (from a drag-to-resume), then the user clicks Resume on "X" before the bridge re-registers, tagging with `intent: "front"`
- **THEN** the second `record` call SHALL overwrite the first
- **AND** when the bridge re-registers "X", `consume("X")` SHALL return `"front"`
- **AND** the server SHALL move "X" to the front of `sessionOrder`

#### Scenario: Registry intent wins over reattach
- **WHEN** the registry is tagged with `intent: "front"` for session "X" AND the bridge re-registers "X" with `registerReason: "reattach"`
- **THEN** the server SHALL apply the registry intent (move-to-front + broadcast)
- **AND** the reattach policy SHALL be ignored for this register

#### Scenario: Expired intent treated as bridge reattach
- **WHEN** the registry was tagged for session "X" more than 60 seconds ago and the bridge re-registers "X" only now
- **THEN** `consume("X")` SHALL return `null` (lazy expiry)
- **AND** if `registerReason: "reattach"` is present, the reattach policy applies; otherwise the server SHALL NOT mutate `sessionOrder`

### Requirement: Reattach placement policy applied on register
When the server receives a `session_register` message with `registerReason: "reattach"` AND no overriding registry intent (`"front"` or `"keep"`), it SHALL apply the placement policy configured by the `reattachPlacement` field of `~/.pi/dashboard/config.json`:

- **`"always"`** (default) — call `sessionOrderManager.moveToFront(cwd, sessionId)` and broadcast `sessions_reordered`. Apply unconditionally regardless of session status.
- **`"streaming-only"`** — call `moveToFront` and broadcast only when the session's **prior status** (the value captured by `memory-session-manager.ts::register` BEFORE coercing `status` to `"active"`) is `"streaming"`. The prior value is forwarded to the policy via `OnChangeContext.priorStatus`; when it is unknown (first-ever register), the helper falls back to the current `session.status`. For all other prior statuses (`"active"`, `"idle"`, `"ended"`), leave order unchanged and do not broadcast.
- **`"preserve"`** — leave `sessionOrder` unchanged and do not broadcast. Equivalent to the legacy `null`-intent reattach behavior.

Application of the policy SHALL happen in the `event-wiring.ts onSessionRegistered` hook, after any pending attach-proposal intent has been consumed.

#### Scenario: Always policy moves reattached session to front regardless of status
- **WHEN** `reattachPlacement` is `"always"` and the bridge re-registers session "s5" with `registerReason: "reattach"` while "s5" has status `"active"` (idle)
- **THEN** the server SHALL call `moveToFront(cwd, "s5")` and broadcast `sessions_reordered`

#### Scenario: Streaming-only policy moves only streaming sessions
- **WHEN** `reattachPlacement` is `"streaming-only"` and the bridge re-registers session "s5" with `registerReason: "reattach"` while "s5" has status `"streaming"`
- **THEN** the server SHALL call `moveToFront(cwd, "s5")` and broadcast `sessions_reordered`

#### Scenario: Streaming-only policy ignores non-streaming reattach
- **WHEN** `reattachPlacement` is `"streaming-only"` and the bridge re-registers session "s5" with `registerReason: "reattach"` while "s5" has status `"active"` (or `"idle"`)
- **THEN** the server SHALL NOT mutate `sessionOrder` and SHALL NOT broadcast

#### Scenario: Preserve policy never moves on reattach
- **WHEN** `reattachPlacement` is `"preserve"` and the bridge re-registers session "s5" with `registerReason: "reattach"` (any status)
- **THEN** the server SHALL NOT mutate `sessionOrder` and SHALL NOT broadcast

#### Scenario: Default policy is always
- **WHEN** `~/.pi/dashboard/config.json` does not include `reattachPlacement` and the bridge re-registers a session with `registerReason: "reattach"`
- **THEN** the server SHALL behave as if `reattachPlacement: "always"` was configured

### Requirement: resume_session message carries placement intent
The `resume_session` browser-to-server message SHALL accept an optional `placement` field of type `"front" | "keep"`. When omitted, the server SHALL default to `"front"`.

The server SHALL tag `pendingResumeIntents` with the resolved value before initiating the spawn so the `onChange` ended→alive branch consumes the correct intent.

#### Scenario: resume_session without placement defaults to front
- **WHEN** the server receives `resume_session { sessionId: "s1", mode: "continue" }` without a `placement` field
- **THEN** the server SHALL tag `pendingResumeIntents.record("s1", "front")`
- **AND** the resulting ended→alive transition SHALL move "s1" to the front of `sessionOrder`

#### Scenario: resume_session with placement: keep is honored
- **WHEN** the server receives `resume_session { sessionId: "s1", mode: "continue", placement: "keep" }`
- **THEN** the server SHALL tag `pendingResumeIntents.record("s1", "keep")`
- **AND** the resulting ended→alive transition SHALL NOT mutate `sessionOrder`

#### Scenario: resume_session with placement: front explicitly
- **WHEN** the server receives `resume_session { sessionId: "s1", mode: "continue", placement: "front" }`
- **THEN** the server SHALL tag `pendingResumeIntents.record("s1", "front")` (identical to the default)

#### Scenario: Fork mode ignores placement field
- **WHEN** the server receives `resume_session { sessionId: "s1", mode: "fork", placement: "keep" }`
- **THEN** the fork SHALL create a new session id (different from "s1") and `placement` SHALL be ignored for the new id
- **AND** any new id placement is governed by the existing fork-after-parent rule, not by this contract

### Requirement: Drag-and-drop reorder via browser
The browser SHALL be able to send a `reorder_sessions` message with the full ordered session ID array for a cwd. The server SHALL replace the stored order with the provided array.

#### Scenario: Reorder via drag-and-drop
- **WHEN** the browser sends `reorder_sessions` with cwd `/project` and sessionIds `["s2", "s1", "s3"]`
- **THEN** the server SHALL store the order as `["s2", "s1", "s3"]` and broadcast `sessions_reordered` to all browsers

### Requirement: Broadcast order changes
The server SHALL broadcast a `sessions_reordered` message to all connected browsers whenever the order for a cwd changes (insert, reorder, or removal).

#### Scenario: Order broadcast on new session
- **WHEN** a new session is prepended to a cwd's order
- **THEN** the server SHALL broadcast `sessions_reordered` with the updated order

#### Scenario: Order broadcast on drag-and-drop
- **WHEN** the browser sends `reorder_sessions`
- **THEN** the server SHALL broadcast `sessions_reordered` to all connected browsers

### Requirement: Prune stale session IDs from order
When returning the order for a cwd, the server SHALL filter out session IDs that no longer exist in the session manager.

#### Scenario: Stale ID pruned
- **WHEN** the order contains `["s1", "s2", "s3"]` but "s2" no longer exists in the session manager
- **THEN** `getOrder(cwd)` SHALL return `["s1", "s3"]`

### Requirement: Client renders sessions in server order
The client SHALL sort session cards within a folder group according to the order received from the server. Sessions not present in the order array SHALL be appended, sorted by `startedAt` descending.

#### Scenario: Sessions rendered in order
- **WHEN** the server order for a cwd is `["s2", "s1"]`
- **THEN** session "s2" SHALL appear before session "s1" in the UI

#### Scenario: Unordered sessions appended
- **WHEN** the server order is `["s1"]` but the group also contains "s2" and "s3"
- **THEN** "s1" SHALL appear first, followed by "s2" and "s3" sorted by `startedAt` descending

### Requirement: Client drag-and-drop interaction
The client SHALL allow users to drag session cards within a folder group to reorder them. On drop, the client SHALL send a `reorder_sessions` message with the new order. The client SHALL use a single `DndContext` for both session card and pinned directory group drag-and-drop, using the `data` property on sortable items to discriminate item types.

#### Scenario: Drag session card in unpinned group
- **WHEN** the user drags session "s2" above session "s1" in an unpinned folder group
- **THEN** the client SHALL send `reorder_sessions` with the updated order array
- **AND** optimistically reorder the cards before server confirmation

#### Scenario: Drag session card in pinned group
- **WHEN** the user drags session "s2" above session "s1" in a pinned folder group
- **THEN** the client SHALL send `reorder_sessions` with the updated order array
- **AND** optimistically reorder the cards before server confirmation

#### Scenario: Drag pinned group does not affect session order
- **WHEN** the user drags a pinned directory group to a new position
- **THEN** the client SHALL reorder pinned directories
- **AND** session order within each group SHALL remain unchanged

#### Scenario: Cross-type drag is ignored
- **WHEN** a session card is dragged over a pinned directory group droppable (or vice versa)
- **THEN** the client SHALL not perform any reorder

### Requirement: Ended-tier sort by endedAt descending
The client SHALL sort session cards within the **ended tier** of a folder group by `(endedAt ?? startedAt)` descending, regardless of `sessionOrder`. The most recently-ended session SHALL appear at the top of the ended tier.

This requirement applies to ended sessions only — the alive tier continues to use the existing `sessionOrder`-then-`startedAt`-desc rule defined in "Client renders sessions in server order".

#### Scenario: ✕ shutdown surfaces card at top of ended tier
- **WHEN** the user clicks the ✕ (shutdown) button on an alive session whose `startedAt` is older than other ended sessions in the same folder
- **THEN** after the alive→ended transition the card SHALL render at the top of the ended tier (because its `endedAt` is the most recent)

#### Scenario: Natural pi exit surfaces card at top of ended tier
- **WHEN** a session naturally ends (pi process exits) while other ended sessions exist in the same folder
- **THEN** the just-ended card SHALL render at the top of the ended tier

#### Scenario: Force-kill surfaces card at top of ended tier
- **WHEN** the user force-kills an alive session via the chat-view force-kill button
- **THEN** after the resulting alive→ended transition the card SHALL render at the top of the ended tier

#### Scenario: Legacy sessions without endedAt fall back to startedAt
- **WHEN** an ended session has no recorded `endedAt` (legacy / pre-migration session) alongside ended sessions that do have `endedAt`
- **THEN** the legacy session SHALL be sorted using its `startedAt` value as if it were `endedAt`, preserving the existing implicit ordering for those entries
