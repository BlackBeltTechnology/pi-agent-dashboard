## MODIFIED Requirements

### Requirement: Continued sessions keep position
When a session is resumed with `mode: "continue"`, the server SHALL choose its placement in the cwd's order array based on a **3-way intent contract** signalled by the `pendingResumeIntents` registry:

- **`"front"`** — move the session id to index 0 of `sessionOrder` regardless of its prior position. Tagged by: Resume button click, REST resume endpoint, and prompt-auto-resume to an ended session (the user is actively interacting). Server SHALL broadcast `sessions_reordered` with the new order.
- **`"keep"`** — leave `sessionOrder` unchanged. The drop position written by an earlier `reorder_sessions` message is the source of truth and MUST NOT be clobbered. Tagged by: drag-to-resume only. Server SHALL NOT broadcast `sessions_reordered` for the transition itself (the drag's `reorder_sessions` already broadcast).
- **No tag** — bridge auto-reattach (e.g. dashboard reload while pi is still alive). Server SHALL NOT mutate `sessionOrder` and SHALL NOT broadcast `sessions_reordered`.

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

#### Scenario: Bridge auto-reattach preserves layout
- **WHEN** the dashboard server restarts and a previously-ended session "s2" reattaches because its pi process is still alive (no `pendingResumeIntents` tag)
- **THEN** the server SHALL NOT modify `sessionOrder` for the cwd
- **AND** the server SHALL NOT broadcast `sessions_reordered` for that transition

#### Scenario: Re-record overwrites prior intent (last-write-wins)
- **WHEN** the registry is tagged with `intent: "keep"` for session "X" (from a drag-to-resume), then the user clicks Resume on "X" before the bridge re-registers, tagging with `intent: "front"`
- **THEN** the second `record` call SHALL overwrite the first
- **AND** when the bridge re-registers "X", `consume("X")` SHALL return `"front"`
- **AND** the server SHALL move "X" to the front of `sessionOrder`

#### Scenario: Expired intent treated as bridge reattach
- **WHEN** the registry was tagged for session "X" more than 60 seconds ago and the bridge re-registers "X" only now
- **THEN** `consume("X")` SHALL return `null` (lazy expiry)
- **AND** the server SHALL NOT mutate `sessionOrder`

## ADDED Requirements

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
