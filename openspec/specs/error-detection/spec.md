## Purpose

Detect terminal LLM/provider errors from agent events and surface them as a dismissable banner in the chat view, distinct from transient retries.
## Requirements
### Requirement: Error extraction from agent_end events
The event reducer SHALL inspect `agent_end` events for error information. When `data.messages` contains a final assistant message with `stopReason === "error"`, the reducer SHALL set `lastError` on `SessionState` with the `errorMessage` value and the event timestamp.

`lastError` SHALL only be set when pi-coding-agent has fully exhausted its auto-retry attempts (i.e. the assistant message with `stopReason: "error"` reaches `agent_end` AS the terminal message). Transient retryable errors that pi-coding-agent retries internally SHALL NOT set `lastError`; they are surfaced to the user via `SessionState.retryState` instead (see `provider-retry-state`).

`lastError` MAY also be set early by the `auto_retry_end` arm when `success: false` and a `finalError` is supplied AND `lastError` is currently undefined; this lets the UI surface terminal cause from an aborted retry without waiting for the upstream `agent_end`.

#### Scenario: LLM provider returns quota exceeded error after retries exhausted
- **WHEN** an `agent_end` event arrives with the last message having `stopReason: "error"` and `errorMessage: "Rate limit exceeded"`
- **THEN** `SessionState.lastError` SHALL be set to `{ message: "Rate limit exceeded", timestamp: <event timestamp> }`
- **AND** `SessionState.status` SHALL be `"idle"`
- **AND** `SessionState.isStreaming` SHALL be `false`
- **AND** `SessionState.retryState` SHALL be cleared

#### Scenario: agent_end without error
- **WHEN** an `agent_end` event arrives with the last message having `stopReason: "end_turn"` (normal completion)
- **THEN** `SessionState.lastError` SHALL remain unchanged (not set)

#### Scenario: agent_end with missing or empty messages array
- **WHEN** an `agent_end` event arrives with no `messages` array or an empty array
- **THEN** `SessionState.lastError` SHALL remain unchanged (defensive fallback)

#### Scenario: usage-limit pattern produces immediate terminal state
- **WHEN** an `agent_end` event arrives whose terminal `errorMessage` matches `/usage[_ ]limit[_ ]reached|usage_not_included|quota[_ ]exceeded|monthly limit|hourly limit/i`
- **AND** `SessionState.retryState` is currently set (a retry banner was visible)
- **THEN** the bridge SHALL have already synthesized an `auto_retry_end { success: false }` BEFORE this `agent_end` (per `provider-retry-state`)
- **AND** `SessionState.retryState` SHALL be cleared
- **AND** `SessionState.lastError` SHALL be set to the errorMessage

#### Scenario: auto_retry_end with finalError populates lastError early when undefined
- **WHEN** `SessionState.lastError` is undefined
- **AND** an `auto_retry_end` event arrives with `data: { success: false, finalError: "Rate limit exceeded" }`
- **THEN** `SessionState.lastError` SHALL be set to `{ message: "Rate limit exceeded", timestamp: <event.timestamp> }`

#### Scenario: auto_retry_end finalError does not overwrite existing lastError
- **WHEN** `SessionState.lastError` is already set to a previous error
- **AND** an `auto_retry_end` event arrives with `success: false` and a `finalError`
- **THEN** `SessionState.lastError` SHALL NOT be overwritten

### Requirement: Error state cleared on new turn
The `lastError` field SHALL be cleared when a new agent turn begins, indicating the error is stale.

#### Scenario: New turn clears previous error
- **WHEN** `lastError` is set from a previous error
- **AND** an `agent_start` event arrives
- **THEN** `SessionState.lastError` SHALL be cleared to `undefined`

### Requirement: Error banner in chat view
The ChatView SHALL render an inline error banner when `SessionState.lastError` is present. The banner SHALL be implemented by a reusable `ErrorBanner` component (`packages/client/src/components/ErrorBanner.tsx`) and SHALL display the error message, a warning icon, a copy-to-clipboard control, and an optional dismiss button. The banner SHALL preserve the `data-testid` attributes `error-banner` and `error-banner-dismiss` so existing integrations and tests continue to work.

#### Scenario: Error banner shown after LLM error
- **WHEN** `SessionState.lastError` is set with a message
- **THEN** a red/amber error banner SHALL be visible at the bottom of the chat above the input area

#### Scenario: Error banner dismissed by user
- **WHEN** user clicks the dismiss button on the error banner
- **THEN** `lastError` SHALL be cleared and the banner SHALL disappear

#### Scenario: Error banner auto-clears on new turn
- **WHEN** a new `agent_start` event arrives
- **THEN** the error banner SHALL disappear

#### Scenario: Error message is copyable
- **WHEN** the error banner is visible
- **THEN** a copy control SHALL be present that writes the full untruncated `lastError.message` to the clipboard via `navigator.clipboard.writeText`

### Requirement: Long error messages collapse with toggle
The error banner SHALL truncate messages longer than a configurable threshold (default 240 characters) to avoid overwhelming the chat view, and SHALL expose a Show more / Show less toggle to reveal the full text.

#### Scenario: Long message is truncated by default
- **WHEN** `lastError.message` exceeds the collapse threshold
- **THEN** the rendered text SHALL be truncated with an ellipsis (`…`)
- **AND** a toggle button labelled "Show more" SHALL be visible

#### Scenario: User expands a truncated message
- **WHEN** the user clicks the "Show more" toggle
- **THEN** the full untruncated message SHALL be rendered
- **AND** the toggle label SHALL change to "Show less"

#### Scenario: Short message has no toggle
- **WHEN** `lastError.message` is at or below the collapse threshold
- **THEN** no Show more / Show less toggle SHALL be rendered

### Requirement: Retry action on error banner
The error banner SHALL render a Retry control when the host view supplies a retry handler. Clicking Retry SHALL re-send the last user-authored prompt for the session via a `send_prompt` message (text + images), so an alive-but-errored session re-runs the same input that originally triggered the failure.

The host view SHALL identify the last user-authored message via a helper that walks `state.messages` newest-to-oldest and returns the first user message's `text` and `images`. When no user message exists in history, the Retry button MAY be hidden or be a no-op.

This replaces the prior `resume_session{mode:"continue"}` behavior, which no-ops on alive-but-errored sessions because the server short-circuits with "Session is already active".

#### Scenario: Retry button re-sends last user prompt
- **GIVEN** the error banner is visible for a session with `lastError` set
- **AND** a retry handler is wired (in App.tsx) that calls `findLastUserPrompt(state.messages)` and then `handleSendPromptToSession(selectedId, text, images)`
- **AND** the session history contains at least one user message with text `"please refactor X"` and no images
- **WHEN** the user clicks the Retry button
- **THEN** a `send_prompt` message SHALL be sent to the server for that session with `text: "please refactor X"` and no `images`
- **AND** when the resulting `agent_start` event arrives the reducer SHALL clear both `lastError` and `retryState`

#### Scenario: Retry button hidden when no handler is provided
- **WHEN** the error banner is rendered without an `onRetry` callback
- **THEN** no Retry button SHALL be rendered

#### Scenario: Retry button no-op when no prior user prompt exists
- **GIVEN** the error banner is visible for a session whose history contains no user-authored messages (defensive edge case)
- **WHEN** the user clicks the Retry button
- **THEN** no `send_prompt` SHALL be sent
- **AND** the banner SHALL remain visible

### Requirement: Error indicator on session card
The session card in the sidebar SHALL show a red status dot when the session has an active error.

#### Scenario: Red dot shown for errored session
- **WHEN** a session has `lastError` set in its `SessionState`
- **THEN** the session card status dot SHALL be red

#### Scenario: Red dot cleared when error dismissed
- **WHEN** `lastError` is cleared (by new turn or user dismiss)
- **THEN** the session card status dot SHALL return to its normal color

