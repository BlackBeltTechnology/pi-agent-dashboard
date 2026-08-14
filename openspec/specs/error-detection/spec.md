## Purpose

Detect terminal LLM/provider errors from agent events and surface them as a dismissable banner in the chat view, distinct from transient retries.
## Requirements
### Requirement: Error extraction from agent_end events

The event reducer SHALL inspect `agent_end` events for error information. When `data.messages` contains a final assistant message with `stopReason === "error"`, the reducer SHALL set `lastError` on `SessionState` with the `errorMessage` value and the event timestamp.

`lastError` SHALL be set primarily via two paths:

1. **`agent_end` extractor**: when pi-coding-agent has fully exhausted its auto-retry attempts AND the terminal assistant message reaches `agent_end` with `stopReason: "error"` AND a non-empty `errorMessage`.

2. **`auto_retry_end` arm with `finalError`**: when the bridge forwards a synthesized `auto_retry_end { success: false, finalError: <string> }` AND `SessionState.lastError` is currently undefined. This covers the observe-based tracker's terminal synth (an error `agent_end` after an observed retry chain, forwarded before `agent_end` per the wire-ordering invariant).

There SHALL be NO usage-limit / `USAGE_LIMIT_PATTERN` synth source. Billing / quota errors are ordinary errors: they reach `lastError` via path (1) or (2) with no special classification, and the `SessionBanner` renders them as an ordinary settled error (no `limit-exceeded` variant — see `session-status-banner`).

The command-handler's synth on user abort does not carry a `finalError` field. Subsequent `agent_end` events surface the real provider error via path (1) when pi emits `stopReason: "error"` with the real `errorMessage`.

Transient retryable errors that pi-coding-agent retries internally SHALL NOT set `lastError` while the retry is in flight; they are surfaced via `SessionState.retryState` instead (see `provider-retry-state`). Once pi settles with a terminal `agent_end` error, `lastError` is set via path (1).

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

#### Scenario: Billing error is an ordinary settled error (no limit-exceeded)
- **WHEN** an `agent_end` arrives with `stopReason: "error"` and `errorMessage: "usage_limit_reached: monthly cap"`
- **THEN** `SessionState.lastError` SHALL be set to `{ message: "usage_limit_reached: monthly cap", timestamp: <event.timestamp> }`
- **AND** NO `USAGE_LIMIT_PATTERN` test SHALL be performed anywhere in the reducer
- **AND** the `SessionBanner` SHALL render the ordinary settled-error card (NOT a `limit-exceeded` variant)

#### Scenario: User abort no longer sets lastError to "Aborted by user"
- **WHEN** the user aborts a retry-in-flight session
- **AND** the bridge synthesizes `auto_retry_end { success: false, attempt: -1 }` with NO `finalError`
- **THEN** `SessionState.lastError` SHALL NOT be set by this synth (reducer requires `typeof data.finalError === "string"`)
- **AND** if pi subsequently emits `agent_end` with a real provider `errorMessage`, `lastError` SHALL be set to that real message
- **AND** if pi does not emit `agent_end` with `stopReason: "error"`, `lastError` SHALL remain undefined and the unified banner SHALL transition to `hidden`

#### Scenario: auto_retry_end with finalError populates lastError early when undefined
- **WHEN** `SessionState.lastError` is undefined
- **AND** an `auto_retry_end` event arrives with `data: { success: false, finalError: "Rate limit exceeded" }`
- **THEN** `SessionState.lastError` SHALL be set to `{ message: "Rate limit exceeded", timestamp: <event.timestamp> }`

#### Scenario: auto_retry_end finalError does not overwrite existing lastError
- **WHEN** `SessionState.lastError` is already set to a previous error
- **AND** an `auto_retry_end` event arrives with `success: false` and a `finalError`
- **THEN** `SessionState.lastError` SHALL NOT be overwritten

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

### Requirement: Error banner in chat view

Terminal errors SHALL be surfaced via the unified `SessionBanner` component (see capability `session-status-banner`). The previous `ErrorBanner` component and the inline `lastError` block in `ChatView` are REMOVED. The banner SHALL render the error as the persistent anchor of the composed error-lifecycle surface, in the `error` sub-state for generic terminal errors (whose `lastError.message` does NOT match `USAGE_LIMIT_PATTERN`) and in the `limit-exceeded` sub-state for terminal billing/quota errors.

The unified banner SHALL preserve the user-facing capabilities of the prior `ErrorBanner`:

- Display of the error message with truncation+toggle on long strings (default threshold 240 characters).
- Copy-to-clipboard control writing the full untruncated `lastError.message` via `navigator.clipboard.writeText`.
- Dismiss action (semantics per `session-status-banner` "Banner actions dispatch through existing handlers": aborts when the surface carries a retrying/retryable state, dismisses-only when terminal).
- Retry action (on the `error` sub-state only — NOT on `limit-exceeded`) that re-sends the last user-authored prompt for the session via `send_prompt`.

The `data-testid` attributes `error-banner` and `error-banner-dismiss` SHALL be preserved on the `SessionBanner` element when rendered in `error` or `limit-exceeded` sub-state, so existing integration tests continue to work.

#### Scenario: Error banner shown after non-billing terminal error
- **WHEN** `SessionState.lastError` is set with a message that does NOT match `USAGE_LIMIT_PATTERN` (e.g. `"tool execution failed"`)
- **THEN** the unified `SessionBanner` SHALL be visible in `error` sub-state
- **AND** the banner SHALL include a Retry and a Dismiss action
- **AND** the DOM element SHALL carry `data-testid="error-banner"`

#### Scenario: Limit-exceeded banner shown after USAGE_LIMIT terminal error
- **WHEN** `SessionState.lastError` is set with a message matching `USAGE_LIMIT_PATTERN` (e.g. `"monthly_spending_cap"`)
- **THEN** the unified `SessionBanner` SHALL be visible in `limit-exceeded` sub-state
- **AND** the banner SHALL NOT include a Retry action
- **AND** the banner SHALL include a Dismiss action
- **AND** the banner SHALL display a "Session stopped automatically." hint
- **AND** the DOM element SHALL carry `data-testid="error-banner"`

#### Scenario: Error banner does NOT auto-clear on new turn
- **WHEN** a new `agent_start` event arrives while `lastError` is set
- **THEN** `lastError` SHALL remain set
- **AND** the unified banner SHALL remain visible until a confirmed non-error response (per "Error state cleared on confirmed-good response")

#### Scenario: Error message is copyable
- **WHEN** the unified banner is visible in `error` or `limit-exceeded` sub-state
- **THEN** a copy control SHALL be present that writes the full untruncated `lastError.message` to the clipboard via `navigator.clipboard.writeText`

### Requirement: Error indicator on session card
The session card in the sidebar SHALL show a red status dot when the session has an active error.

#### Scenario: Red dot shown for errored session
- **WHEN** a session has `lastError` set in its `SessionState`
- **THEN** the session card status dot SHALL be red

#### Scenario: Red dot cleared when error dismissed
- **WHEN** `lastError` is cleared (by new turn or user dismiss)
- **THEN** the session card status dot SHALL return to its normal color
