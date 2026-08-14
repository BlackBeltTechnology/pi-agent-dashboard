## ADDED Requirements

### Requirement: Retry action on every settled provider error

The unified error surface SHALL render a Retry control whenever a provider error is settled: `lastError` is set and no retry sub-status is active. Activating Retry SHALL trigger a new non-user turn on the already-active session, so the failed response is re-driven without spawning a second session process and without appending or duplicating a user message. The action SHALL be single-shot; repeated clicks before lifecycle advancement SHALL emit no duplicate turn, and failure SHALL settle again with Retry available.

A pending automatic retry SHALL NOT show the Retry control because pi already owns the retry. A user abort SHALL hide the surface and SHALL NOT offer Retry for the cancelled chain.

#### Scenario: Retried provider error continues without duplicate input

- **GIVEN** a settled provider error with no retry sub-status
- **WHEN** the user activates Retry
- **THEN** the client SHALL issue one internal retry action to the existing active bridge
- **AND** the bridge SHALL trigger a non-user custom turn
- **AND** no resume/spawn operation or duplicate user message SHALL be produced

#### Scenario: Repeated Retry click is one-shot

- **GIVEN** a settled provider error and an enabled Retry control
- **WHEN** the user activates Retry more than once before lifecycle state changes
- **THEN** exactly one internal retry action SHALL be emitted
- **AND** the control SHALL remain disabled until retry state or error state changes

#### Scenario: Retry is available for both error-entry channels

- **GIVEN** `lastError` was set from either an errored assistant turn or a terminal retry-end carrying `finalError`
- **AND** no retry sub-status is active
- **THEN** the settled surface SHALL offer Retry

#### Scenario: Retry is absent while pi is retrying

- **GIVEN** a retry sub-status is waiting or in flight
- **THEN** the surface SHALL NOT offer Retry

#### Scenario: Failed one-shot Retry settles again

- **GIVEN** the user activated Retry on a settled provider error
- **WHEN** the continued turn ends with another provider error and no automatic retry remains
- **THEN** the surface SHALL settle again with Retry available, even when the provider error text is unchanged
- **AND** Retry availability SHALL reset from the new error lifecycle identity rather than message-text equality
- **AND** the Retry action SHALL NOT arm a separate dashboard retry loop

## MODIFIED Requirements

### Requirement: Error state cleared on confirmed-good response

`SessionState.lastError` SHALL persist while a retry or continuation is pending and SHALL clear on the first confirmed non-error assistant completion for the session. The recovery SHALL be recognized whether the turn was started by a user message, a manual continue-resume, or pi's automatic post-retry continuation.

An errored attempt SHALL not become terminal while another attempt is active. When retries exhaust or pi does not automatically retry, `lastError` SHALL remain as a settled error. A user abort SHALL clear both retry and error presentation for the cancelled chain, and delayed events from that chain SHALL not recreate the surface before the next explicit run.

Every terminal transition SHALL converge to one of two outcomes: a provider error remains as a settled surface with Retry and a state-clearing X, or success, user abort, or confirmed session termination clears the surface automatically. A terminal transition SHALL NOT leave a visible banner in a retrying presentation or without a valid closing path. If terminal settle has no new assistant disposition but retains a prior provider error, that error SHALL settle with Retry and X rather than remain pending.

A browser `session_removed` message SHALL be treated as confirmed termination and SHALL clear retry/error presentation for that session. A raw bridge or browser WebSocket disconnect SHALL NOT be treated as termination because the session can reconnect. A preceding `session_orphaned` notification SHALL continue through its separate error toast, then `session_removed` SHALL still clear the retry/error banner.

#### Scenario: Error persists while a retry is pending

- **GIVEN** `lastError` is set and a retry sub-status is active
- **WHEN** the next attempt starts without a new user message
- **THEN** `lastError` SHALL remain set during the attempt
- **AND** the surface SHALL remain in its pending-retry presentation

#### Scenario: Automatic continuation clears on non-error assistant completion

- **GIVEN** `lastError` is set from a failed attempt and pi automatically started a continuation
- **WHEN** the continued attempt emits a non-error assistant completion
- **THEN** `lastError` and the retry sub-status SHALL clear
- **AND** the error/retry surface SHALL become hidden without user action

#### Scenario: User-started recovery clears on non-error assistant completion

- **GIVEN** `lastError` is set from a settled provider error
- **WHEN** a manual Retry or a new user turn emits a non-error assistant completion
- **THEN** `lastError` SHALL clear
- **AND** the settled error surface SHALL become hidden

#### Scenario: Error from agent_end settles when no retry follows

- **GIVEN** an errored assistant turn is surfaced through the terminal turn-end channel
- **WHEN** the session settles without another retry attempt
- **THEN** `lastError` SHALL remain set
- **AND** the surface SHALL render as a settled provider error

#### Scenario: Error from terminal retry-end settles when no turn error was retained

- **GIVEN** no current `lastError` exists
- **WHEN** a failed retry-end carries a non-empty `finalError`
- **THEN** `lastError` SHALL be set from `finalError`
- **AND** the surface SHALL render as a settled provider error

#### Scenario: Retries exhausted retain the provider error

- **GIVEN** every attempt in a retry chain ends with a provider error
- **WHEN** pi emits the terminal settle event
- **THEN** the retry sub-status SHALL clear
- **AND** `lastError` SHALL remain visible as a settled error

#### Scenario: User abort hides the cancelled chain

- **GIVEN** an error/retry surface is visible for an active retry chain
- **WHEN** the user activates the session Stop control
- **THEN** retry and error presentation for that chain SHALL clear
- **AND** the banner SHALL remain hidden if delayed events from the cancelled chain arrive

#### Scenario: Terminal settle with retained provider error becomes dismissible

- **GIVEN** `lastError` is set from a provider failure and retrying was active
- **WHEN** the chain settles without a new assistant disposition
- **THEN** the retry sub-status SHALL clear
- **AND** the error SHALL render as a settled surface with Retry and X

#### Scenario: Confirmed full session termination hides retry and error presentation

- **GIVEN** retry and/or error presentation exists for a session
- **WHEN** the browser receives `session_removed` for that session after clean shutdown or force-kill
- **THEN** retry and error presentation SHALL clear
- **AND** the session SHALL be marked ended

#### Scenario: Orphan warning remains separate from banner cleanup

- **GIVEN** retry and/or error presentation exists for a session
- **WHEN** the browser receives `session_orphaned` followed by `session_removed`
- **THEN** the existing orphan-process error toast SHALL be emitted
- **AND** retry and error presentation SHALL clear on removal

#### Scenario: Temporary disconnect does not fake termination

- **GIVEN** retry and/or error presentation exists for a session
- **WHEN** the browser connection or bridge connection drops without `session_removed`
- **THEN** retry and error presentation SHALL remain available for reconnection
- **AND** no success, abort, or terminal provider outcome SHALL be synthesized from disconnect alone

#### Scenario: No terminal state leaves a stuck banner

- **WHEN** a retry chain stops for success, provider failure, user abort, or confirmed session termination
- **THEN** provider failure SHALL render a settled Retry + X surface
- **AND** success, abort, or confirmed termination SHALL render no error/retry surface
- **AND** no visible terminal surface SHALL retain a pending-retry-only control state
