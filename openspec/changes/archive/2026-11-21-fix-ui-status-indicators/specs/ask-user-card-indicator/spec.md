## MODIFIED Requirements
### Requirement: Idle (turn-finished) state uses a distinct label
The `ActivityIndicator` SHALL display **"Idle"** (muted), NOT "Waiting for input", when a session is `idle`/`active` with no `currentTool` set and no unresolved error (`hasError` false). An idle/active session with `hasError` true reads "Failed" instead (`session-card-status`). The string "Waiting for input" SHALL NOT be shared between the `ask_user`
(blocked) state and the `idle`/`active` (passive) state.
#### Scenario: Finished turn shows Idle
- **WHEN** `session.status` is `idle` or `active`
- **AND** `session.currentTool` is unset
- **AND** `hasError` is false
- **THEN** the activity indicator shows "Idle" in a muted color
- **AND** does NOT show "Waiting for input"
#### Scenario: Finished turn with an error does not show Idle
- **WHEN** `session.status` is `idle` or `active`
- **AND** `session.currentTool` is unset
- **AND** `hasError` is true
- **THEN** the activity indicator shows "Failed", not "Idle"
#### Scenario: Blocked and idle labels never collide
- **WHEN** one card is `ask_user` (chat-routed) and another is `idle`
- **THEN** the two activity-indicator labels SHALL be different strings
