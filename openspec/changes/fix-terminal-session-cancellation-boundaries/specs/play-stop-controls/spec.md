## MODIFIED Requirements

### Requirement: Stop button during streaming

A red Stop button SHALL appear at the end of the input field while the session is streaming, has a pending prompt, or has `SessionState.retryState` set. Stop SHALL request cancellation of the current turn. Force Stop SHALL appear only after the cancellation grace expires while the session remains active.

#### Scenario: Stop button visible during streaming

- **WHEN** the session status is `streaming`
- **THEN** the red Stop button SHALL be visible next to the Play button

#### Scenario: Stop button visible during retry

- **WHEN** `SessionState.retryState` is set
- **THEN** the red Stop button SHALL remain visible even if `isStreaming` is temporarily false

#### Scenario: Stop requests turn cancellation

- **GIVEN** the session is streaming or retrying
- **WHEN** the user activates Stop
- **THEN** the client SHALL send `abort` for that session
- **AND** the control SHALL enter an aborting state
- **AND** the label or tooltip SHALL identify the action as cancelling the current turn

#### Scenario: Stop succeeds during retry backoff

- **GIVEN** the session is waiting on provider retry backoff
- **WHEN** the user activates Stop
- **THEN** the retry wait SHALL end without another provider request
- **AND** the Stop control SHALL reset when the session reports quiescence

#### Scenario: Force Stop appears after abort grace

- **GIVEN** the client sent `abort`
- **WHEN** the session remains streaming or retrying after the configured grace period
- **THEN** the control SHALL display an orange Force Stop action
- **AND** its copy SHALL state that it terminates the pi process

#### Scenario: Force Stop sends process escalation

- **WHEN** the user activates Force Stop
- **THEN** the client SHALL send `force_kill` for that session
- **AND** the control SHALL enter a non-interactive killing state

#### Scenario: Stop button hidden while idle

- **WHEN** the session is idle or ended with no pending prompt and no retry state
- **THEN** the Stop control SHALL be hidden

### Requirement: Killing state feedback

After Force Stop is requested, the control SHALL remain in a non-interactive killing state until a matching `force_kill_result` or session end is received. Failure SHALL restore an actionable escalation state and SHALL not imply that the process stopped.

#### Scenario: Killing state displayed

- **WHEN** `force_kill` is sent
- **THEN** the control SHALL display a disabled `Killing...` state

#### Scenario: Verified kill succeeds

- **WHEN** the client receives matching `force_kill_result { success: true }`
- **THEN** the control SHALL clear as the session transitions to ended

#### Scenario: Force kill fails

- **WHEN** the client receives matching `force_kill_result { success: false, message }`
- **THEN** the client SHALL display the failure message
- **AND** the control SHALL return to an actionable Force Stop state
- **AND** the client SHALL NOT present the session as ended because of that result
