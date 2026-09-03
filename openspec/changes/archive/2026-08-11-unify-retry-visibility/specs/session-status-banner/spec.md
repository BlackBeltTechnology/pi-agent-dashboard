# session-status-banner delta

## MODIFIED Requirements

### Requirement: Banner is observe-only: no abort control, no collapse

The banner SHALL NOT render any session-abort control. The always-present session Stop (outside
the banner) is the sole abort entry point, and it ends pi's retry chain. There SHALL be NO
"Stop retrying" control in the banner.

A state-clearing dismiss (`error-banner-dismiss`, `mdiClose`, invoking the clear-only
`onDismiss`) SHALL be offered in EVERY visible state, including while a `retry` sub-status is
carried — see *Dismiss control is always present and clear-only*. The surface ALSO clears via
its own lifecycle: when `retryState` clears and `lastError` clears (a confirmed-good resume).
There SHALL be NO collapse control and NO collapsed pill.

This requirement previously withheld the dismiss control while a retry was pending. Combined
with the removal of the collapse pill that left the surface with NEITHER affordance, so a
persistent error card could not be cleared during a retry at all.

The settled surface SHALL NOT render a Retry control. The removed `findLastUserPrompt` →
`send_prompt` re-send SHALL NOT return, and no replacement re-drive SHALL be introduced: the
dashboard has no mechanism to re-run a settled turn without appending input.

#### Scenario: No abort control in the banner while retrying

- **GIVEN** the surface carries a `retry` sub-status
- **THEN** the banner SHALL NOT render a Stop retrying control
- **AND** the banner SHALL NOT render a collapse control
- **AND** the banner SHALL render the retry status sub-line, Copy, and the clear-only dismiss

#### Scenario: Session Stop ends a pending retry

- **GIVEN** a retry is pending
- **WHEN** the user activates the always-present session Stop (outside the banner)
- **THEN** pi's retry chain SHALL be ended

#### Scenario: Settled error offers a state-clearing dismiss

- **GIVEN** `lastError` is set AND `retryState` is undefined
- **WHEN** the user activates the dismiss control
- **THEN** `onDismiss` SHALL fire, clearing `lastError`
- **AND** NO `abort` message SHALL be dispatched

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
