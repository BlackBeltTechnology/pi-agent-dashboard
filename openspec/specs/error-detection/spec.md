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

`SessionState.lastError` SHALL persist across the start of a retry or continuation turn and
SHALL clear only on a confirmed non-error response for the session. A settled error whose retry
chain is still running SHALL NOT be presented as terminal: while a `retry` sub-status is
carried the surface SHALL present a pending retry, and the error anchor SHALL remain as its
header.

Because pi fires one `agent_end` per retry attempt, an `agent_end` carrying an error SHALL NOT
by itself be treated as the end of the lifecycle; only `agent_settled` terminates it.

#### Scenario: Error persists while a retry is pending

- **GIVEN** `lastError` is set AND a `retry` sub-status is carried
- **WHEN** the next attempt starts
- **THEN** `lastError` SHALL remain set
- **AND** the surface SHALL continue to show the error text as the card header

#### Scenario: Error clears on a confirmed non-error response

- **WHEN** a turn for the session completes with a non-error stop reason
- **THEN** `SessionState.lastError` SHALL be cleared
- **AND** the surface SHALL become hidden once `retryState` is also undefined

#### Scenario: The error persists when retries run out

- **GIVEN** pi has exhausted `retry.maxRetries` and the chain terminated with an error
- **WHEN** `agent_settled` clears the retry sub-status
- **THEN** `SessionState.lastError` SHALL remain set
- **AND** the surface SHALL remain visible as a settled error, with a state-clearing dismiss
- **AND** the message SHALL NOT auto-hide when retrying stops

#### Scenario: A retrying chain is not presented as terminal

- **GIVEN** an attempt ended with an error AND a further attempt is pending
- **THEN** the surface SHALL render the pending-retry presentation (Stop retrying, attempt,
  countdown)
- **AND** the surface SHALL NOT render the settled presentation (clearing dismiss)

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

