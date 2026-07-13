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

The `lastError` field SHALL persist across the start of a retry/continuation turn and SHALL be cleared ONLY when the subsequent turn produces a **confirmed non-error response**. `agent_start` alone SHALL NOT clear `lastError`.

A confirmed non-error response is the first of the following observed after `lastError` was set:

- an assistant `message_end` with a terminal-success `stopReason`, OR
- a clean `agent_end` whose last message has a terminal-success `stopReason`.

Terminal-success `stopReason` = pi-ai `"stop"` (the real over-the-wire value for a normal completion); `"end_turn"` is also accepted (Anthropic-normalized / fixture value). Mid-turn / non-success stops (`"toolUse"`/`"tool_use"`, `"error"`, `"aborted"`, `"length"`) SHALL NOT clear `lastError`: the turn can still error after a tool-use stop, AND pi fires an `agent_end` carrying a `toolUse` last message when a turn yields at an interactive tool (e.g. `ask_user`) — a mid-turn pause, not a successful response. Clearing on any non-success stop would reintroduce a clear→re-set flicker and would wrongly drop the error anchor across an interactive pause or a user abort.

Until that signal arrives, the error-lifecycle surface SHALL keep showing the prior `lastError` (as the persistent anchor) with the live retry status composed on top of it.

A brand-new (non-retry) user prompt SHALL NOT optimistically clear `lastError`. The error anchor persists across a new prompt's `agent_start` and clears only on that new turn's confirmed non-error response (same rule as a retry). The abort latch is cleared on the new prompt (per `provider-retry-state`) so the new turn runs freely; only the display anchor lingers.

`retryState` clearing is unchanged (cleared on `auto_retry_end`, `agent_start`, `agent_end` per `provider-retry-state`). Only `lastError` lifetime changes here.

#### Scenario: agent_start no longer clears lastError
- **GIVEN** `SessionState.lastError` is set from a previous error
- **WHEN** an `agent_start` event arrives
- **THEN** `SessionState.lastError` SHALL remain set
- **AND** the error-lifecycle surface SHALL remain visible

#### Scenario: Confirmed non-error message_end clears lastError
- **GIVEN** `SessionState.lastError` is set
- **AND** an `agent_start` for the retry/continuation turn has arrived (lastError still set)
- **WHEN** an assistant `message_end` with `stopReason: "end_turn"` arrives
- **THEN** `SessionState.lastError` SHALL be cleared to `undefined`
- **AND** the error-lifecycle surface SHALL transition to `hidden`

#### Scenario: Brand-new user prompt does not clear stale error until confirmed-good
- **GIVEN** `SessionState.lastError` is set from a previous turn
- **WHEN** the user sends a NEW (non-retry) prompt and its `agent_start` arrives
- **THEN** `SessionState.lastError` SHALL remain set (no optimistic clear on send)
- **AND** `SessionState.lastError` SHALL clear only when the new turn produces a confirmed non-error response (`stopReason === "end_turn"` message_end or clean `agent_end`)

#### Scenario: Failed retry keeps the error visible (no flicker)
- **GIVEN** `SessionState.lastError` is set
- **WHEN** the retry turn fails again (`agent_end` with `stopReason: "error"`)
- **THEN** `SessionState.lastError` SHALL be updated to the new error WITHOUT a hidden intermediate frame
- **AND** the surface SHALL NOT have flashed to `hidden` between `agent_start` and the new error

#### Scenario: Mid-turn tool_use stop does NOT clear lastError
- **GIVEN** `SessionState.lastError` is set
- **AND** an `agent_start` for the retry/continuation turn has arrived (lastError still set)
- **WHEN** an assistant `message_end` with `stopReason: "tool_use"` arrives
- **THEN** `SessionState.lastError` SHALL remain set
- **AND** the error-lifecycle surface SHALL remain visible
- **AND** a subsequent `agent_end` with `stopReason: "error"` SHALL update `lastError` WITHOUT the surface having flashed to `hidden`

#### Scenario: agent_end yielding at an interactive tool does NOT clear lastError
- **GIVEN** `SessionState.lastError` is set
- **AND** a new turn has started (`agent_start`) that emits an `ask_user` tool call
- **WHEN** an `agent_end` arrives whose last message has `stopReason: "tool_use"` (the turn paused awaiting the answer)
- **THEN** `SessionState.lastError` SHALL remain set
- **AND** the error-lifecycle surface SHALL remain visible

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

### Requirement: Retry action on error banner

The unified `SessionBanner` SHALL render a Retry control ONLY in the `error` sub-state (NOT in `limit-exceeded`). Clicking Retry SHALL re-send the last user-authored prompt for the session via a `send_prompt` message (text + images), so an alive-but-errored session re-runs the same input that originally triggered the failure.

The retried user message SHALL be visually deduplicated in the chat view per the "Manual retry hides duplicate user bubble in chat view" requirement in `session-status-banner`.

The host view SHALL identify the last user-authored message via a helper that walks `state.messages` newest-to-oldest and returns the first user message's `text` and `images`. When no user message exists in history, the Retry button MAY be hidden or be a no-op.

#### Scenario: Retry button re-sends last user prompt and dedupes bubble
- **GIVEN** the unified banner is visible in `error` sub-state for a session with `lastError` set
- **AND** the session history contains [user("please refactor X"), assistant(error)]
- **AND** a retry handler is wired in App.tsx
- **WHEN** the user clicks the Retry button
- **THEN** a `send_prompt` message SHALL be sent with `text: "please refactor X"`
- **AND** when the resulting `message_start { role: "user", content: "please refactor X" }` event arrives the chat view SHALL render only ONE "please refactor X" user bubble
- **AND** the prior `lastError` SHALL remain visible until the retry produces a confirmed non-error response (per "Error state cleared on confirmed-good response")

#### Scenario: Retry button absent in limit-exceeded variant
- **WHEN** the unified banner is in `limit-exceeded` sub-state
- **THEN** no Retry button SHALL be rendered in the DOM
- **AND** no `onRetry` callback SHALL be invocable from the banner

#### Scenario: Retry button hidden when no handler is provided
- **WHEN** the unified banner is rendered in `error` sub-state without an `onRetry` callback
- **THEN** no Retry button SHALL be rendered

#### Scenario: Retry button no-op when no prior user prompt exists
- **GIVEN** the unified banner is visible in `error` sub-state for a session whose history contains no user-authored messages
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

