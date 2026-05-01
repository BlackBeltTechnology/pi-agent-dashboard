## MODIFIED Requirements

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

## ADDED Requirements

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
