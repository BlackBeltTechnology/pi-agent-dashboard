# session-status-banner Specification

## Purpose

Unified single-banner component (`SessionBanner`) for per-session retry/error/limit state, mounted sticky above the `CommandInput`. Replaces the prior split `<RetryBanner>` + inline-`lastError` block in `ChatView`. Variant derived by a pure selector over `SessionState`.
## Requirements
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

### Requirement: Banner mounts sticky above CommandInput

`SessionBanner` SHALL be mounted in the layout tree between `ChatView` and `CommandInput` (not inside `ChatView`). The banner SHALL NOT scroll with chat content. It SHALL occupy a single row of vertical space and SHALL collapse to zero height when in `hidden` variant.

The legacy `RetryBanner.tsx` component SHALL be removed. The inline `lastError` red-banner block previously rendered inside `ChatView.tsx` SHALL be removed. No code path SHALL render two banner components for the same session.

#### Scenario: Banner appears above CommandInput in the DOM tree
- **WHEN** the dashboard renders for a session with `retryState` set
- **THEN** the `SessionBanner` element SHALL appear in the DOM between the chat scroll container and the `CommandInput` element

#### Scenario: Banner does not scroll with chat
- **WHEN** the user scrolls through chat history
- **AND** `retryState` or `lastError` is set
- **THEN** the `SessionBanner` SHALL remain visible regardless of chat scroll position

#### Scenario: Legacy RetryBanner is removed
- **WHEN** searching for `RetryBanner` component imports across `packages/client/`
- **THEN** no production code path SHALL import or render `RetryBanner`

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

### Requirement: Manual retry hides duplicate user bubble in chat view

When the user clicks the "Retry" action on the `error` variant, the resulting new user message in the session SHALL be flagged with `retriedFrom: <previousUserEntryId>` in `SessionState.messages[]`, and the chat view SHALL skip rendering the bubble for the duplicate.

The flag SHALL be set by the reducer when ALL of the following are true:

- A `message_start` event arrives for a user-role message
- The text content of the new message exactly matches the text of the immediately-preceding user message in `state.messages`
- The turn between those two user messages ended in `lastError` (i.e. the most recent prior assistant message had `stopReason: "error"` OR an `agent_end` set `lastError`)

The session JSONL on pi's side SHALL retain both user entries unchanged. Only the live chat view in the dashboard collapses the duplicate. Resume / fork of the session SHALL see both entries (no persistent-side dedup).

#### Scenario: Retry button send produces flagged message that does not render
- **GIVEN** chat history is [user("fix bug"), assistant(stopReason="error")]
- **AND** the user clicks Retry on the `error` banner
- **WHEN** the resulting `message_start { role: "user", content: "fix bug" }` event arrives
- **THEN** the reducer SHALL flag the new `ChatMessage` with `retriedFrom: <entryId of the first "fix bug" message>`
- **AND** the chat view SHALL render only ONE "fix bug" user bubble
- **AND** the subsequent assistant response from the retry SHALL render normally below it

#### Scenario: Manual identical re-send after successful turn does NOT dedupe
- **GIVEN** chat history is [user("ping"), assistant(stopReason="end_turn")]
- **AND** the user types "ping" again and presses Enter
- **WHEN** the resulting `message_start { role: "user", content: "ping" }` event arrives
- **THEN** the reducer SHALL NOT set `retriedFrom` (the preceding turn ended successfully)
- **AND** the chat view SHALL render both "ping" bubbles

#### Scenario: Different text after error does NOT dedupe
- **GIVEN** chat history is [user("fix bug"), assistant(stopReason="error")]
- **AND** the user types "fix the bug" (different text) and sends
- **WHEN** the resulting `message_start { role: "user", content: "fix the bug" }` event arrives
- **THEN** the reducer SHALL NOT set `retriedFrom`
- **AND** the chat view SHALL render both bubbles

#### Scenario: JSONL persistence unchanged by dedup
- **GIVEN** a session whose JSONL on disk contains [user("X"), assistant(error), user("X"), assistant(success)]
- **WHEN** the session is resumed in a new dashboard tab
- **THEN** both user("X") entries SHALL appear in the session's underlying entries
- **AND** the chat view SHALL still apply the dedup rule on render (showing one bubble) when the second user("X") has `retriedFrom` flagged at message_start time

### Requirement: Shared error-pattern module

`USAGE_LIMIT_PATTERN` SHALL live in `packages/shared/src/error-patterns.ts` as a named export. The extension package's `usage-limit-orderer.ts` SHALL re-export the same constant for source compatibility with code that imports it from there. No duplicated regex literal SHALL exist in either the client or the extension.

The pattern source-of-truth SHALL be the version currently in `packages/extension/src/usage-limit-orderer.ts:30`:

```
/usage[_ ]limit[_ ]reached|usage_not_included|insufficient_quota|credit[_ ]balance|quota[_ ]exceeded|resource[_ ]exhausted|monthly[_ ]limit|monthly[_ ]spending[_ ]cap|hourly[_ ]limit|daily[_ ]limit|spending[_ ]cap|exceeded[^"]{0,40}(quota|cap|spending)|reset after \d+[hms]/i
```

#### Scenario: Pattern matches all documented terminal categories
- **WHEN** the pattern is tested against each of: `"usage_limit_reached"`, `"quota_exceeded"`, `"insufficient_quota"`, `"credit balance"`, `"monthly_spending_cap"`, `"resource_exhausted"`, `"reset after 12h"`
- **THEN** each test SHALL return `true`

#### Scenario: Pattern does NOT match generic retryable errors
- **WHEN** the pattern is tested against `"fetch failed"`, `"ECONNRESET"`, `"timeout"`, `"429 Too Many Requests"` (without quota suffix)
- **THEN** each test SHALL return `false`

#### Scenario: Extension re-export resolves to shared module
- **WHEN** code imports `USAGE_LIMIT_PATTERN` from `packages/extension/src/usage-limit-orderer.ts`
- **THEN** the resolved binding SHALL reference the export from `packages/shared/src/error-patterns.ts`
- **AND** the regex `.source` SHALL match the shared module's export `.source`

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

