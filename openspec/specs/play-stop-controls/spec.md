## Purpose

Give the user a single inline control to interrupt an in-flight session: send `abort` first; escalate to `force_kill` after a grace period if the agent does not quiesce.

## Requirements

### Requirement: Stop button during streaming
A red Stop button (■) SHALL appear at the end of the input field when the session is streaming OR when the server reports the session as running OR when a pending prompt exists OR when `SessionState.retryState` is set. When clicked, it SHALL send an `abort` message and transition to a "Force Stop" state.

The session status the Stop control reads is the reconciled composer liveness defined in "Composer liveness is reconciled with the server session status". In particular: the server reports the session as running when its server-held status is `streaming`; the `active` status SHALL NOT be treated as running, because it is the resting state of a registered session; and when the server holds any status for the session, that status SHALL take precedence over the event-derived chat status.

A reconciled status of `ended` is terminal: no Stop or Force-Stop control SHALL be shown, and the retry condition above SHALL NOT show one either. The sole exception is the pending-prompt cancel: while a `pendingPrompt` with status `sending` exists, the control that cancels it SHALL remain available (it cancels the prompt; it never escalates to Force Stop).

#### Scenario: Ended server status suppresses a latched chat streaming state
- **GIVEN** the chat state derived from replayed events reads "streaming" because a run start was replayed without its end
- **WHEN** the server-held status for the same session is "ended"
- **THEN** no Stop or Force-Stop button is visible

#### Scenario: Unknown server status leaves the chat status in force
- **GIVEN** the session is not present in the live session map, so no server-held status is available
- **WHEN** the chat state reads "streaming"
- **THEN** a red Stop button is visible next to the Play button

#### Scenario: Stop button visible during streaming
- **WHEN** the session status is "streaming"
- **THEN** a red Stop button is visible next to the Play button

#### Scenario: Stop button visible when only the server reports the run
- **GIVEN** the chat state derived from replayed events reads "idle" because the run's `agent_start` was not re-delivered
- **WHEN** the server-held status for the same session is "streaming"
- **THEN** a red Stop button is visible next to the Play button

#### Scenario: Connected idle session shows no Stop button
- **GIVEN** the chat state reads "idle"
- **WHEN** the server-held status for the session is "active"
- **THEN** no Stop button is visible and the Send control remains shown

#### Scenario: Stop button visible during pending
- **WHEN** a `pendingPrompt` exists on the session state
- **THEN** a red Stop button is visible next to the Play button

#### Scenario: Stop button visible during retry phase
- **WHEN** `SessionState.retryState` is set (an LLM-provider retry is in flight)
- **THEN** a red Stop button is visible next to the Play button
- **AND** the Stop button SHALL remain visible even when `isStreaming` is briefly false between retries

#### Scenario: Stop button hidden when idle
- **WHEN** the reconciled composer liveness is "idle" or "ended" AND no `pendingPrompt` exists AND `retryState` is undefined
- **THEN** the Stop button is not visible

#### Scenario: Server idle overrides a latched chat streaming state
- **GIVEN** the chat state reads "streaming" because the browser missed the run's end
- **WHEN** the server-held status for the session is "idle"
- **THEN** no Stop button is visible and the Send control is shown

#### Scenario: Server active overrides a latched chat streaming state
- **GIVEN** the chat state reads "streaming"
- **WHEN** the server-held status for the session is "active"
- **THEN** no Stop button is visible and the Send control is shown

#### Scenario: Chat ended between runs with server idle shows no Stop button
- **GIVEN** the chat state reads "ended" (between a run end and its settle)
- **WHEN** the server-held status for the session is "idle"
- **THEN** no Stop button is visible

#### Scenario: Missed new run is recovered from the server
- **GIVEN** the chat state reads "ended" from the previous run
- **WHEN** the server-held status for the session is "streaming"
- **THEN** a red Stop button is visible

#### Scenario: Retry on a known non-terminal session keeps the Stop button
- **GIVEN** `SessionState.retryState` is set and the chat state reads "ended" between attempts
- **WHEN** the server-held status for the session is "idle"
- **THEN** a red Stop button is visible

#### Scenario: Retry on a server-ended session shows no Stop button
- **GIVEN** `SessionState.retryState` is still set because the session was killed during a retry sleep
- **WHEN** the server-held status for the session is "ended"
- **THEN** no Stop or Force-Stop button is visible

#### Scenario: Pending prompt on a server-ended session keeps only the cancel control
- **GIVEN** a `pendingPrompt` with status "sending" exists
- **WHEN** the server-held status for the session is "ended"
- **THEN** the control that cancels the pending prompt is visible
- **AND** no Force-Stop control is shown

#### Scenario: Remaining reconciliation cells
- **GIVEN** no `pendingPrompt` exists and `retryState` is undefined
- **WHEN** the chat status and server-held status are, respectively: "idle" and absent; "idle" and "idle"; "idle" and "ended"; "ended" and absent; "ended" and "active"; "ended" and "ended"
- **THEN** no Stop button is visible

#### Scenario: Both sources report the run
- **GIVEN** the chat status reads "streaming"
- **WHEN** the server-held status for the session is "streaming"
- **THEN** a red Stop button is visible

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

#### Scenario: Force Stop sends force_kill
- **WHEN** user clicks the "Force Stop" button
- **THEN** a `force_kill` message is sent to the session
- **AND** the button transitions to "Killing..." state (non-interactive)

#### Scenario: Button resets when session stops streaming
- **WHEN** the reconciled composer liveness changes away from "streaming" AND `retryState` is undefined
- **THEN** the button state resets to initial (no abort/force-kill state)

#### Scenario: Button does not reset while only the server reports the run
- **GIVEN** a Stop has been sent and the control is in its abort/force-kill state
- **WHEN** the chat status leaves "streaming" but the server-held status is still "streaming"
- **THEN** the button state does NOT reset to initial

### Requirement: Killing state feedback
When a force kill has been initiated, the button SHALL show a "Killing..." label and be non-interactive until the reconciled composer liveness changes. The status that clears the state is the reconciled value (the server-held status when the server holds one, else the event-derived chat status), not the raw event-derived chat status, so the label SHALL NOT clear while the server still reports the session as running.

#### Scenario: Killing state displayed
- **WHEN** a `force_kill` message has been sent
- **THEN** the button SHALL display "Killing..." with a disabled/non-interactive appearance

#### Scenario: Killing state clears on session end
- **WHEN** the reconciled composer liveness becomes "ended" after a force kill
- **THEN** the button SHALL be hidden (standard behavior for ended sessions)

#### Scenario: Killing state persists while the server still reports the run
- **GIVEN** a `force_kill` has been sent and the button shows "Killing..."
- **WHEN** the event-derived chat status reads "idle" but the server-held status is still "streaming"
- **THEN** the button SHALL keep showing "Killing..." rather than resetting to the initial state

### Requirement: Composer liveness is reconciled with the server session status

The composer SHALL derive its liveness from a single reconciled value. When the server holds a status for the session, that status is authoritative: `ended` yields `ended`, `streaming` yields `streaming`, and `idle` or `active` yield `idle`, regardless of the event-derived chat status. When the server holds no status for the session (it is not in the live session map), the event-derived chat status is used unchanged. Every composer surface that presents run liveness — the Stop / Force-Stop control, the stop-after-turn affordance, the session-actions strip above the input, the activity line above the composer, the mobile session info strip's working label, and the liveness value handed to composer plugin panels — SHALL read that one reconciled value, so they can never disagree with each other or with the session card.

Composer controls that gate on "the agent is working" — the Stop / Force-Stop control, the stop-after-turn affordance, and the session-actions strip's working state — SHALL share one working condition: the reconciled value is `streaming`, OR an LLM-provider retry is recorded AND the reconciled value is not `ended`. A recorded retry SHALL NOT make any of them read as working on a session whose reconciled value is `ended`. The session card's working state SHALL apply the same condition to its server-held status, so card and strip agree.

The reconciliation SHALL be a derivation only. The chat transcript SHALL remain a function of real events: no run-start event is fabricated, no streaming assistant bubble appears, and no pending-prompt state is cleared as a result of the server-side signal.

#### Scenario: Card and composer agree after a reload mid-run
- **GIVEN** a session whose agent is running
- **WHEN** the user reloads the dashboard and opens that session, and the replayed events do not re-establish the run start
- **THEN** the session card shows the session as running
- **AND** the composer shows the Stop control
- **AND** the activity line above the composer presents the session as working

#### Scenario: Reconciled liveness reaches composer plugin panels
- **GIVEN** the reconciled liveness reads `streaming` only because of the server-held status
- **WHEN** a plugin-contributed composer panel reads the session status it is given
- **THEN** it receives `streaming`, the same value the Stop control acts on

#### Scenario: No fabricated transcript activity
- **GIVEN** the reconciled liveness reads `streaming` only because of the server-held status
- **WHEN** the chat transcript is rendered
- **THEN** no streaming assistant bubble is shown for a message the client never received
- **AND** any pending prompt the client is holding remains untouched

#### Scenario: Turn end hides the Stop control without lingering
- **GIVEN** a session that is running and whose composer shows the Stop control
- **WHEN** the run reaches its end and both the server-held status and the chat status leave `streaming`
- **THEN** the composer returns to its Send control
- **AND** no Stop control remains visible after the chat status settles to idle

#### Scenario: Ended session never shows a Stop control
- **GIVEN** a session whose server-held status is `ended`
- **WHEN** the session is opened after a reload
- **THEN** the composer shows no Stop or Force-Stop control
- **AND** this holds even when the event-derived chat status still reads `streaming` or a provider retry is still recorded

#### Scenario: Session-actions strip agrees with the Stop control on a killed retrying session
- **GIVEN** `SessionState.retryState` is still set because the session was killed during a retry sleep
- **WHEN** the server-held status for the session is `ended`
- **THEN** the session-actions strip does not present the session as working
- **AND** no Stop or Force-Stop control is shown

#### Scenario: Stop-after-turn follows the same reconciled liveness
- **GIVEN** the reconciled liveness reads `streaming` only because of the server-held status
- **WHEN** the composer is rendered
- **THEN** the stop-after-turn affordance is offered alongside the Stop control, exactly as it is for a chat-derived `streaming` state

#### Scenario: Mobile info strip agrees with the composer
- **GIVEN** a mobile viewport and a session whose chat status reads "idle" after a reload
- **WHEN** the server-held status for the session is "streaming"
- **THEN** the session info strip presents the session as working
