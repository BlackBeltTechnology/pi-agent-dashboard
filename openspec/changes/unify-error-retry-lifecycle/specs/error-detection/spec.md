## MODIFIED Requirements

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
