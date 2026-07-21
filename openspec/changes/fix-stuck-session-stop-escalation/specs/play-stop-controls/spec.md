# play-stop-controls Specification (delta)

## MODIFIED Requirements

### Requirement: Stop button during streaming
A red Stop button (■) SHALL appear at the end of the input field when the session is streaming OR when a pending prompt exists OR when `SessionState.retryState` is set. When clicked, it SHALL send an `abort` message and transition to a "Force Stop" state.

#### Scenario: Stop button visible during streaming
- **WHEN** the session status is "streaming"
- **THEN** a red Stop button is visible next to the Play button

#### Scenario: Stop button visible during pending
- **WHEN** a `pendingPrompt` exists on the session state
- **THEN** a red Stop button is visible next to the Play button

#### Scenario: Stop button visible during retry phase
- **WHEN** `SessionState.retryState` is set (an LLM-provider retry is in flight)
- **THEN** a red Stop button is visible next to the Play button
- **AND** the Stop button SHALL remain visible even when `isStreaming` is briefly false between retries

#### Scenario: Stop button hidden when idle
- **WHEN** the session status is "idle" or "ended" AND no `pendingPrompt` exists AND `retryState` is undefined
- **THEN** the Stop button is not visible

#### Scenario: Stop button sends abort
- **WHEN** user clicks the Stop button while session is streaming
- **THEN** an `abort` message is sent to the session
- **AND** the button transitions to "Force Stop" state (orange, pulsing animation) only after the 3 s grace period elapses without the session quiescing

#### Scenario: Stop button during retry sleep clears retryState within 200ms
- **GIVEN** the session has `retryState` set
- **WHEN** user clicks the Stop button
- **THEN** an `abort` message SHALL be sent
- **AND** within 200 ms (perceived) the bridge's synthesized `auto_retry_end` SHALL clear `retryState` in the client
- **AND** if the session does not transition to idle within 3 s the button SHALL escalate to Force Stop

#### Scenario: Force Stop button visible after abort grace period
- **WHEN** an abort has been sent AND the session is still active (streaming OR retryState set) after a 3 s grace period
- **THEN** an orange pulsing "Force Stop" button (⚠) SHALL be displayed instead of the red Stop button

#### Scenario: Force Stop emphasized when abort stalls
- **WHEN** the button has been in the Force Stop state for more than 5 s with the session still streaming
- **THEN** the Force Stop button SHALL be visually emphasized (pulse retained) with a tooltip/title stating the abort did not land and Force Stop kills the process

#### Scenario: Force Stop sends force_kill
- **WHEN** user clicks the "Force Stop" button
- **THEN** a `force_kill` message is sent to the session
- **AND** the button transitions to "Killing..." state (non-interactive)

#### Scenario: Button resets when session stops streaming
- **WHEN** the session status changes away from "streaming" AND `retryState` is undefined
- **THEN** the button state resets to initial (no abort/force-kill state)

### Requirement: Killing state feedback
When a force kill has been initiated, the button SHALL show a "Killing..." label and be non-interactive until the session status changes OR a failed `force_kill_result` arrives.

#### Scenario: Killing state displayed
- **WHEN** a `force_kill` message has been sent
- **THEN** the button SHALL display "Killing..." with a disabled/non-interactive appearance

#### Scenario: Killing state clears on session end
- **WHEN** the session status changes to "ended" after a force kill
- **THEN** the button SHALL be hidden (standard behavior for ended sessions)

#### Scenario: Killing state reverts on failed kill
- **WHEN** `force_kill_result { success: false }` arrives for the session
- **THEN** the button SHALL revert from "Killing..." to the Force Stop state (interactive)
- **AND** an error toast with the failure message SHALL be shown
