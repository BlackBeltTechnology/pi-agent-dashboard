# session-status-banner delta

## ADDED Requirements

### Requirement: Dismiss control is always present and clear-only

The banner SHALL render its dismiss (✕) control in every visible state,
including while a retry is waiting and while an attempt is in flight. The
control SHALL be clear-only: it removes the banner from view and SHALL NOT
abort, cancel or otherwise influence the retry loop, which pi owns.

Dismissal SHALL be transient, not sticky — a subsequent retry signal for the
same session SHALL re-open the banner carrying the current attempt number.

The banner SHALL NOT offer any control that purports to stop retrying.

#### Scenario: Dismiss renders while retrying
- **GIVEN** `retryState` is set with `waiting: false`
- **THEN** the banner SHALL render its dismiss control
- **AND** the banner SHALL NOT render a collapse control

#### Scenario: Dismiss renders while waiting
- **GIVEN** `retryState` is set with `waiting: true` and a `nextAttemptAt`
- **THEN** the banner SHALL render its dismiss control
- **AND** the countdown SHALL remain visible alongside it

#### Scenario: Dismiss does not abort the retry
- **GIVEN** a retry chain is in flight
- **WHEN** the user activates the dismiss control
- **THEN** the banner SHALL be removed from view
- **AND** no abort, cancel or stop command SHALL be dispatched for that session

#### Scenario: Next attempt re-opens a dismissed banner
- **GIVEN** the user dismissed the banner during attempt 2
- **WHEN** a waiting or in-flight signal arrives for attempt 3
- **THEN** the banner SHALL render again
- **AND** it SHALL display attempt `3`

#### Scenario: Success clears the banner permanently
- **GIVEN** the banner is visible for a retrying session
- **WHEN** a turn completes whose last assistant message is not an error
- **THEN** `lastError` and `retryState` SHALL both be cleared
- **AND** the banner SHALL be hidden without user action

#### Scenario: No stop-retrying affordance exists
- **WHEN** the banner is rendered in any state
- **THEN** no control labelled or acting as "stop retrying" SHALL be present
