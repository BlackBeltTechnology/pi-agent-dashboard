## MODIFIED Requirements

### Requirement: Single banner component with composed error-lifecycle surface

The dashboard SHALL render exactly one banner component (`SessionBanner`) per selected session, mounted sticky above the `CommandInput` (between `ChatView` and `CommandInput`). The banner is a single **error-lifecycle surface** whose contents are derived from a single selector over `SessionState`. Two banner components SHALL NEVER be visible simultaneously for the same session.

The surface composes an optional **error anchor** (from `lastError`) with an optional **live status sub-line** (from `retryState`), rather than picking one mutually-exclusive variant. The previous "`retrying` wins over `error`" precedence is REPLACED by composition: when both `retryState` and `lastError` are set, the error anchor renders as the persistent header AND the retry status renders as a sub-line within the same surface.

Surface states:

- **error anchor + retrying sub-line** (red header, amber sub-line): `lastError` set AND `retryState` set. Header shows the error message; sub-line shows attempt count / countdown or indeterminate "retrying…" + a "Stop retrying" action.
- **retrying only** (amber): `retryState` set, `lastError` undefined (auto-retry before any terminal error). Shows `retryState.reason` + "Stop retrying".
- **error only** (red): `lastError` set (not matching `USAGE_LIMIT_PATTERN`), `retryState` undefined. Shows message + Retry + Dismiss + copy.
- **limit-exceeded** (red, 💳): `lastError` set AND matches `USAGE_LIMIT_PATTERN`. Shows message + Dismiss + "Session stopped automatically." hint; NO Retry.
- **hidden**: neither field set → nothing rendered.

The error anchor SHALL persist while a retry runs on top of it; the surface SHALL clear only when `lastError` clears (per `error-detection` "Error state cleared on confirmed-good response") and `retryState` is undefined.

#### Scenario: Error anchor persists while retry runs on top
- **WHEN** `SessionState.lastError = { message: "429 rate limited", timestamp: 0 }` AND `SessionState.retryState = { attempt: 2, maxAttempts: -1, delayMs: -1, reason: "rate limit", startedAt: 0 }`
- **THEN** the surface SHALL render the error message "429 rate limited" as a persistent header
- **AND** the surface SHALL render the "retrying… (attempt 2)" status as a sub-line in the SAME banner
- **AND** a "Stop retrying" action SHALL be present

#### Scenario: Retrying-only when no terminal error yet
- **WHEN** `SessionState.retryState` is set AND `SessionState.lastError` is undefined
- **THEN** the surface SHALL render the amber retrying status with `reason`
- **AND** a "Stop retrying" action SHALL be present

#### Scenario: Auto-retry does NOT promote a red error header before terminal failure
- **GIVEN** `SessionState.retryState` is set from an in-progress auto-retry
- **AND** `SessionState.lastError` is undefined (no terminal `agent_end(error)` yet)
- **THEN** the surface SHALL render ONLY the amber retrying sub-line
- **AND** the surface SHALL NOT render a red error header
- **AND** a red error header SHALL appear only once `lastError` is set by a terminal `agent_end` with `stopReason: "error"`

#### Scenario: Error-only after retries settle
- **WHEN** `SessionState.lastError` is set (not USAGE_LIMIT) AND `retryState` is undefined
- **THEN** the surface SHALL render the error message with Retry + Dismiss + copy

#### Scenario: Hidden when neither field is set
- **WHEN** `SessionState.retryState` is undefined AND `SessionState.lastError` is undefined
- **THEN** the `SessionBanner` SHALL render nothing (no DOM)

### Requirement: Banner-state selector is a pure function

A helper `deriveBannerState(state: SessionState): BannerState` SHALL be exported from `packages/client/src/lib/event-reducer.ts`. The selector SHALL be pure (no side effects, deterministic on its input) and SHALL be the sole determinant of what the `SessionBanner` renders. The host component SHALL NOT compute composition or precedence inline.

The selector's return shape SHALL carry BOTH the optional error anchor and the optional retry sub-status (composition), not a single mutually-exclusive variant:

```ts
type BannerState =
  | { variant: "hidden" }
  | {
      // present iff lastError set
      error?: { kind: "error" | "limit-exceeded"; message: string };
      // present iff retryState set
      retry?: { attempt: number; maxAttempts: number; delayMs: number; startedAt: number; reason: string };
    };
```

`error.kind` is `"limit-exceeded"` when `USAGE_LIMIT_PATTERN.test(lastError.message)`, else `"error"`. `USAGE_LIMIT_PATTERN` SHALL be imported from `packages/shared/src/error-patterns.ts`. The selector SHALL return `{ variant: "hidden" }` only when BOTH `lastError` and `retryState` are undefined.

#### Scenario: Selector returns hidden for empty state
- **WHEN** `deriveBannerState({ retryState: undefined, lastError: undefined, … })` is called
- **THEN** the return SHALL be `{ variant: "hidden" }`

#### Scenario: Selector composes error + retry when both set
- **WHEN** `deriveBannerState({ retryState: { attempt: 2, maxAttempts: -1, delayMs: -1, reason: "rate limit", startedAt: 0 }, lastError: { message: "429", timestamp: 1 }, … })` is called
- **THEN** the return SHALL include `error: { kind: "error", message: "429" }`
- **AND** the return SHALL include `retry: { attempt: 2, … reason: "rate limit" }`

#### Scenario: Selector marks limit-exceeded for USAGE_LIMIT match
- **WHEN** `deriveBannerState({ retryState: undefined, lastError: { message: "quota_exceeded for org x", timestamp: 1 }, … })` is called
- **THEN** the return SHALL include `error: { kind: "limit-exceeded", message: "quota_exceeded for org x" }`
- **AND** the return SHALL NOT include a `retry` field

### Requirement: Banner actions dispatch through existing handlers

The "Stop retrying" action SHALL invoke the same `wrappedHandleAbort` callback the main Stop button uses (snapshotting queues into draft before dispatching the WS `abort`).

The "Retry" action (error-only sub-state) SHALL invoke `onRetryAfterError`: re-send `findLastUserPrompt(state.messages)` via `send_prompt`.

The "Dismiss" (✕) action SHALL be **state-dependent**:

- When the surface carries a `retry` sub-status OR a generic retryable `error` (kind `"error"`), Dismiss ✕ SHALL invoke the abort flow (`wrappedHandleAbort`) AND clear `lastError`. Dismissing a retrying/retryable surface means "stop and clear", so pi SHALL stop retrying — not merely hide the message.
- When the surface is terminal `limit-exceeded` (pi has already stopped), Dismiss ✕ SHALL only clear `lastError` (no abort needed).

#### Scenario: Stop retrying triggers abort
- **GIVEN** the surface carries a `retry` sub-status
- **WHEN** the user clicks "Stop retrying"
- **THEN** the client SHALL invoke `wrappedHandleAbort()` for the selected session

#### Scenario: Dismiss on retrying surface aborts AND clears
- **GIVEN** the surface carries a `retry` sub-status (pi is mid-retry)
- **WHEN** the user clicks Dismiss (✕)
- **THEN** the client SHALL invoke `wrappedHandleAbort()` for the session
- **AND** `SessionState.lastError` SHALL be cleared
- **AND** pi SHALL NOT continue retrying (per `provider-retry-state` abort-latch)

#### Scenario: Dismiss on limit-exceeded only clears
- **GIVEN** the surface is in `limit-exceeded` (pi already stopped)
- **WHEN** the user clicks Dismiss (✕)
- **THEN** `SessionState.lastError` SHALL be cleared
- **AND** no abort SHALL be dispatched (nothing is running)

#### Scenario: Retry on error-only resends last prompt
- **GIVEN** the surface is `error`-only AND chat history contains a user message "fix the bug"
- **WHEN** the user clicks "Retry"
- **THEN** the client SHALL dispatch `send_prompt { text: "fix the bug" }` for the session

## ADDED Requirements

### Requirement: Single red surface — inline chat error card suppressed during active error-lifecycle

While the error-lifecycle surface owns a failure for a session (i.e. `deriveBannerState` returns a non-hidden state with an `error` or `retry`), the chat message stream SHALL NOT render a duplicate full red error card for that same failure. The failed attempt SHALL collapse to a compact badge (same pattern as `RetriedErrorBadge` for tool retries) or be hidden, so yellow (retry sub-status) and red (settled error) NEVER appear on two separate surfaces simultaneously for the same session.

This extends the single-surface guarantee beyond the banner selector: the invariant "exactly one red/amber surface per session failure" SHALL hold across the banner AND the inline chat stream.

#### Scenario: Inline failed-attempt card collapses while surface is active
- **GIVEN** the chat stream contains a `toolResult` / assistant row whose failure is the same one driving the active error-lifecycle surface
- **WHEN** the `SessionBanner` is rendering that failure (error and/or retry)
- **THEN** the inline chat stream SHALL NOT render a second full red error card for the same failure
- **AND** the failed attempt SHALL appear as a compact collapsible badge (or be hidden)

#### Scenario: No simultaneous yellow + red across surfaces
- **GIVEN** `retryState` is set (amber) for a session
- **WHEN** the chat stream and the banner both render
- **THEN** at most ONE surface SHALL show the failure's red/amber state at a time
- **AND** the user SHALL NOT see a yellow banner above a red inline error card for the same failure
