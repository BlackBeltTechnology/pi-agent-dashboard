# provider-retry-state delta

## ADDED Requirements

### Requirement: Dismissing an error surface never mutates retry state

`SessionState.retryState` has two consumers: the error surface renders it, and
the command input derives its working state from it to decide whether the
session abort control is mounted. A view-level dismissal SHALL NOT write to it.

Collapsing or dismissing an error surface SHALL therefore leave
`SessionState.retryState` unchanged. Only retry lifecycle events
(`auto_retry_*`, `agent_start`, `agent_settled`) may clear it.

#### Scenario: Collapsing while retrying leaves retry state intact
- **GIVEN** a session whose state has `retryState` set at attempt 2
- **WHEN** the user collapses the error surface
- **THEN** `SessionState.retryState` SHALL remain set at attempt 2
- **AND** the session SHALL remain a member of the retry set

#### Scenario: Dismissing a settled error does not resurrect or clear retry state
- **GIVEN** a session with `lastError` set and `retryState` undefined
- **WHEN** the user dismisses the error surface
- **THEN** `SessionState.lastError` SHALL be cleared
- **AND** `SessionState.retryState` SHALL remain undefined

#### Scenario: The abort control survives a dismissal during a retry
- **GIVEN** a retry is pending and the session abort control is displayed
- **WHEN** the user collapses the error surface
- **THEN** the session abort control SHALL remain displayed
