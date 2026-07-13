# provider-retry-state Specification

## Purpose
TBD - created by archiving change fix-provider-retry-infinite-loop. Update Purpose after archive.
## Requirements
### Requirement: Reducer tracks in-flight retry state

The event reducer SHALL maintain a `retryState` field on `SessionState` describing the current LLM-provider retry phase. The field SHALL be set on `auto_retry_start` and cleared on `auto_retry_end`, `agent_start`, and `agent_end`.

The shape SHALL be:
```ts
retryState?: {
  attempt: number;       // 1-based attempt number
  maxAttempts: number;   // total attempts pi-coding-agent will make
  delayMs: number;       // milliseconds between this attempt and the next
  reason: string;        // errorMessage that triggered this retry
  startedAt: number;     // event.timestamp at auto_retry_start
}
```

#### Scenario: auto_retry_start sets retryState
- **WHEN** an `auto_retry_start` event arrives with `data: { attempt: 1, maxAttempts: 3, delayMs: 2000, errorMessage: "rate limit exceeded" }`
- **THEN** `SessionState.retryState` SHALL equal `{ attempt: 1, maxAttempts: 3, delayMs: 2000, reason: "rate limit exceeded", startedAt: <event.timestamp> }`
- **AND** `SessionState.lastError` SHALL remain unchanged

#### Scenario: auto_retry_end with success clears retryState
- **WHEN** `retryState` is set
- **AND** an `auto_retry_end` event arrives with `data: { success: true, attempt: 2 }`
- **THEN** `SessionState.retryState` SHALL be cleared to undefined
- **AND** `SessionState.lastError` SHALL remain unchanged

#### Scenario: auto_retry_end with failure clears retryState and surfaces error early
- **WHEN** `retryState` is set
- **AND** an `auto_retry_end` event arrives with `data: { success: false, attempt: 3, finalError: "Rate limit exceeded" }`
- **AND** `SessionState.lastError` is currently undefined
- **THEN** `SessionState.retryState` SHALL be cleared
- **AND** `SessionState.lastError` SHALL be set to `{ message: "Rate limit exceeded", timestamp: <event.timestamp> }`

#### Scenario: auto_retry_end after lastError already set
- **WHEN** `auto_retry_end` arrives with `success: false` and a `finalError`
- **AND** `SessionState.lastError` is already set (e.g. by an earlier `agent_end`)
- **THEN** `SessionState.retryState` SHALL be cleared
- **AND** `SessionState.lastError` SHALL NOT be overwritten

#### Scenario: agent_start defensively clears stale retryState
- **WHEN** `retryState` is set (e.g. session reload mid-retry)
- **AND** an `agent_start` event arrives
- **THEN** `SessionState.retryState` SHALL be cleared to undefined

#### Scenario: agent_end defensively clears retryState
- **WHEN** `retryState` is set
- **AND** an `agent_end` event arrives
- **THEN** `SessionState.retryState` SHALL be cleared after the existing `lastError` extraction logic runs

#### Scenario: auto_retry_end ignored when retryState is undefined
- **WHEN** `SessionState.retryState` is undefined
- **AND** an `auto_retry_end` event arrives
- **THEN** `SessionState.retryState` SHALL remain undefined
- **AND** `SessionState.lastError` SHALL NOT be modified by this event

### Requirement: Retry banner in chat view

The dashboard SHALL surface in-flight provider retries via the unified `SessionBanner` component (see capability `session-status-banner`), rendered in the `retrying` variant when `SessionState.retryState` is set. The previous standalone `<RetryBanner>` component is REMOVED; banner placement moves from inside `ChatView` to sticky above the `CommandInput`.

In the `retrying` variant the banner SHALL display:

- Attempt phrasing. When `retryState.maxAttempts > 0` AND `retryState.delayMs > 0`, the phrasing SHALL include current attempt and max attempts plus a live countdown to `startedAt + delayMs`, refreshed at least once per second, never going below 0. When either is `<= 0` (sentinel — indeterminate retry; bridge does not know pi's retry settings), the banner SHALL show an indeterminate "retrying…" message instead.
- A "Stop retrying" button that triggers the same `wrappedHandleAbort` flow as the main Stop button.
- The original `reason` string, truncated to a single line with overflow ellipsis.

#### Scenario: Banner visible during retry with known countdown
- **WHEN** `retryState = { attempt: 2, maxAttempts: 3, delayMs: 4000, reason: "rate limit exceeded", startedAt: 1700000000000 }`
- **THEN** the unified `SessionBanner` SHALL be visible in the `retrying` variant
- **AND** the banner SHALL include text identifying attempt 2 of 3
- **AND** a "Stop retrying" button SHALL be rendered

#### Scenario: Banner shows indeterminate state when delayMs is sentinel -1
- **WHEN** `retryState = { attempt: 1, maxAttempts: -1, delayMs: -1, reason: "rate limit exceeded", startedAt: 0 }`
- **THEN** the banner SHALL be visible in the `retrying` variant
- **AND** the banner SHALL show "retrying…" without a countdown
- **AND** a "Stop retrying" button SHALL be rendered

#### Scenario: Banner countdown reaches zero and stays
- **WHEN** the banner is mounted with `startedAt + delayMs` already elapsed AND `delayMs > 0`
- **THEN** the displayed countdown SHALL be `0` (not negative)
- **AND** the banner SHALL remain visible until `retryState` is cleared

#### Scenario: Stop retrying button triggers abort
- **GIVEN** the banner is in `retrying` variant
- **WHEN** the user clicks "Stop retrying"
- **THEN** `wrappedHandleAbort()` SHALL be invoked for the selected session
- **AND** an `abort` message SHALL be sent for the current session
- **AND** the banner SHALL clear once `retryState` is cleared (typically within ≤200ms via the bridge's synthetic auto_retry_end)

#### Scenario: Banner clears on auto_retry_end
- **GIVEN** the banner is in `retrying` variant
- **WHEN** an `auto_retry_end` event arrives (success or failure)
- **THEN** the banner SHALL no longer render in the `retrying` variant
- **AND** the banner SHALL transition to `error` / `limit-exceeded` (if `lastError` is set) or `hidden`

### Requirement: Session card amber dot during retry

A session card in the sidebar SHALL render an amber pulsing status dot when its `SessionState.retryState` is set AND `SessionState.lastError` is undefined. This visual SHALL be distinct from the existing red error dot and the default idle/streaming/ended dots.

#### Scenario: Amber dot during retry
- **WHEN** the session has `retryState` set and `lastError` is undefined
- **THEN** the session card status dot SHALL be amber and pulsing

#### Scenario: Red error dot wins over amber
- **WHEN** the session has both `retryState` set AND `lastError` set
- **THEN** the session card status dot SHALL be red (lastError takes precedence)

#### Scenario: Dot returns to default after retry clears
- **WHEN** `retryState` is cleared (success or failure)
- **AND** `lastError` is undefined
- **THEN** the session card status dot SHALL return to its non-error default

### Requirement: Bridge synthesizes auto_retry_start from observed message_end

The bridge SHALL maintain a per-session retry tracker. Retry detection SHALL be derived from OBSERVED pi behavior, NOT from a regex classifier. The bridge SHALL NOT test any `RETRYABLE_PATTERN` / copy of pi's internal `_isRetryableError`.

Rule: when pi emits `message_end` whose `message.role === "assistant"` AND `message.stopReason === "error"`, the bridge SHALL record a pending failure for the session (it does NOT yet know whether pi will retry). When pi subsequently emits a fresh assistant `message_start` for the same agent turn (i.e. before any `agent_end` for that turn and with no intervening user prompt), that observed new attempt SHALL cause the bridge to forward a synthesized `event_forward` with `eventType: "auto_retry_start"` and `data: { attempt: <1-based observed-attempt counter>, maxAttempts: -1, delayMs: -1, errorMessage: <observed errorMessage> }`. The session SHALL be marked as in retry until cleared.

`maxAttempts: -1` and `delayMs: -1` are sentinels: pi does not expose its retry settings to extensions, so the dashboard SHALL render an indeterminate "retrying…" UI instead of a countdown. During pi's backoff sleep (before the next `message_start`), the surface SHALL show the error without a "retrying…" sub-line; the sub-line appears when the next attempt is observed.

#### Scenario: Observed new attempt after an error triggers synthesized auto_retry_start
- **GIVEN** the bridge forwarded a `message_end` with `message: { role: "assistant", stopReason: "error", errorMessage: "overloaded" }` (pending failure recorded)
- **WHEN** the bridge observes a fresh assistant `message_start` for the same agent turn with no intervening user prompt
- **THEN** the bridge SHALL forward an `event_forward` with `event.eventType === "auto_retry_start"`
- **AND** the synthesized event SHALL have `data.attempt >= 1`, `data.maxAttempts === -1`, `data.delayMs === -1`, `data.errorMessage === "overloaded"`

#### Scenario: No regex gate on the error message
- **GIVEN** the bridge forwarded a `message_end` with `errorMessage: "prompt is too long: 300000 tokens > 200000 maximum"` (a string pi will NOT retry)
- **WHEN** no fresh assistant `message_start` follows (pi ends the turn with `agent_end` error)
- **THEN** NO `auto_retry_start` SHALL be synthesized (because no new attempt was observed, NOT because a regex rejected the string)

#### Scenario: Successful assistant message_end clears retry tracker and synthesizes auto_retry_end
- **GIVEN** the bridge previously synthesized `auto_retry_start` for session X
- **WHEN** the bridge forwards a subsequent `message_end` with `message: { role: "assistant", stopReason: "end_turn" }`
- **THEN** the bridge SHALL forward a synthesized `auto_retry_end { success: true, attempt: <last attempt> }`
- **AND** the retry tracker SHALL clear its in-flight flag for session X

### Requirement: Bridge synthesizes auto_retry_end on user abort

The bridge command handler SHALL synthesize and forward an `auto_retry_end` event immediately after invoking `cachedCtx.abort()` on receipt of an `abort` command. The synthesized event SHALL be forwarded via the existing `event_forward` wire shape so the dashboard can clear `retryState` optimistically.

The synthesized payload SHALL be `data: { success: false, attempt: -1 }` — `finalError` is OMITTED. The previous hardcoded `"Aborted by user"` placeholder is REMOVED. Rationale: when the orderer's pending flag survives user abort (see "Bridge persistent-abort scheduler closes retry race" and the wrapper-abort changes in `mid-turn-prompt-queue`), pi's terminal `agent_end` will surface the actual provider `errorMessage` via the orderer's natural synth path. The command-handler's immediate synth only needs to clear `retryState`, not invent a finalError that overwrites the truth.

The synthetic event SHALL be idempotent: subsequent synthesized or natural `auto_retry_end`s are no-ops in the reducer when `retryState` is already undefined.

#### Scenario: Abort during retry clears retryState within 200ms with no finalError
- **GIVEN** a session with `retryState` set
- **WHEN** the bridge receives `{ type: "abort", sessionId }`
- **THEN** the bridge SHALL invoke `cachedCtx.abort()`
- **AND** the bridge SHALL forward an `event_forward` whose `event.eventType === "auto_retry_end"` and `event.data` matches `{ success: false, attempt: -1 }`
- **AND** `event.data.finalError` SHALL NOT be present (or SHALL be `undefined`)
- **AND** `SessionState.lastError` SHALL NOT be set by this synth alone (the reducer only sets lastError when `typeof data.finalError === "string"`)

#### Scenario: Abort outside retry phase is harmless
- **GIVEN** a session with `retryState` undefined (e.g. mid-stream, not retrying)
- **WHEN** the bridge receives `abort`
- **THEN** the synthesized `auto_retry_end` SHALL still be forwarded
- **AND** the reducer SHALL ignore it (no-op per the auto_retry_end-without-retryState rule)

#### Scenario: Abort during retry surfaces real provider error via agent_end
- **GIVEN** a session with `retryState` set (reason: `"rate_limit_exceeded — usage_limit_reached"`)
- **AND** the orderer's `pending` flag is true for the session
- **WHEN** the user aborts AND pi subsequently emits `agent_end` with `messages[last].errorMessage === "usage_limit_reached: monthly cap"` AND `stopReason: "error"`
- **THEN** the synth-on-abort `auto_retry_end{success:false, attempt:-1}` (no finalError) SHALL clear `retryState` without setting `lastError`
- **AND** the bridge's `agent_end` handler SHALL invoke `usageLimitOrderer.maybeSynthesize()` which returns `{ finalError: "usage_limit_reached: monthly cap" }` (orderer pending was NOT cleared by wrapper-abort)
- **AND** the resulting synthesized `auto_retry_end` SHALL set `SessionState.lastError = { message: "usage_limit_reached: monthly cap", … }`
- **AND** the unified `SessionBanner` SHALL render in `limit-exceeded` variant carrying the real provider error

### Requirement: Bridge persistent-abort scheduler closes retry race

On receipt of `abort`, after invoking the full bridge wrapper-abort once synchronously (which calls `cachedCtx.abort()` and resets shadow queues — see `mid-turn-prompt-queue`), the bridge SHALL ensure pi's in-flight retry is stopped even when the provider backoff is longer than the persistent-abort window. The bridge SHALL combine two mechanisms:

1. **Persistent-abort scheduler (fast path).** The bridge SHALL schedule raw `cachedCtx.abort()` calls at 200 ms intervals for up to 2 seconds, stopping on ANY of: `cachedCtx.isIdle?.()` returns `true`; `isAgentStreaming` transitions from `true` (at start) to `false` (`agent_end` processed); or 2 seconds elapsed. The scheduled tick SHALL invoke `cachedCtx.abort()` directly (via the `rawAbort` option), NOT the full wrapper, so the wrapper's recurring side-effects do not clobber a user prompt that lands within the window.

2. **Abort latch (covers long backoff).** The bridge SHALL set a per-session `abortRequested` latch when the abort command is received. Whenever pi re-enters its retry continuation after a backoff sleep (i.e. the bridge observes the agent attempting to continue the same aborted turn — a fresh `agent_start`/`message_start` for a turn that has NOT seen an intervening user prompt), the bridge SHALL call `cachedCtx.abort()` again to honor the latch. The latch SHALL be cleared when the aborted turn settles (`agent_end` / `isIdle`) OR when a new user prompt is sent for the session. This closes the gap where a 5–60 s provider backoff outlives the 2 s scheduler and pi resumes the retry with a fresh `_retryAbortController` that never saw the abort signal.

The scheduler and latch SHALL both cancel/clear if the bridge is unloaded or a new session takes over.

#### Scenario: Persistent abort fires repeatedly until agent is idle, using rawAbort
- **GIVEN** the bridge receives `abort` while the agent is mid-retry
- **AND** `cachedCtx.isIdle()` returns false initially AND `isAgentStreaming` is `true` at scheduler start
- **THEN** the bridge SHALL call `cachedCtx.abort()` again at ~200 ms intervals
- **AND** the bridge SHALL NOT re-run the wrapper's queue-clearing logic on each tick
- **AND** SHALL stop once `isIdle()` returns true OR `isAgentStreaming` flips to false OR after 2 s elapsed

#### Scenario: Abort latch stops a retry that wakes after the 2 s scheduler window
- **GIVEN** the bridge received `abort` while pi was sleeping on a 30 s provider backoff
- **AND** the persistent-abort scheduler has already stopped after 2 s
- **AND** the `abortRequested` latch is set for the session
- **WHEN** pi wakes from backoff and attempts to continue the same aborted turn (no intervening user prompt)
- **THEN** the bridge SHALL call `cachedCtx.abort()` again to honor the latch
- **AND** pi SHALL NOT proceed with the retry continuation

#### Scenario: Latch cleared by a new user prompt does not kill the new turn
- **GIVEN** the `abortRequested` latch is set
- **WHEN** the user sends a NEW prompt for the session
- **THEN** the latch SHALL be cleared
- **AND** the new prompt's resulting `agent_start` SHALL NOT be aborted by the latch

#### Scenario: Latch cleared on settle
- **GIVEN** the `abortRequested` latch is set
- **WHEN** the aborted turn settles (`agent_end` fired OR `cachedCtx.isIdle()` returns true)
- **THEN** the latch SHALL be cleared
- **AND** no further latch-driven `cachedCtx.abort()` calls SHALL be made

#### Scenario: Persistent abort stops on streaming-false transition
- **GIVEN** the bridge has begun the persistent-abort schedule with `isAgentStreaming === true` at start
- **WHEN** `agent_end` arrives and the bridge flips `isAgentStreaming` to `false`
- **THEN** the next scheduler tick SHALL observe the transition AND clear the interval
- **AND** no further scheduler-driven `cachedCtx.abort()` calls SHALL be made

### Requirement: Bridge wire-ordering invariant for synthesized retry events

The bridge SHALL forward any synthesized `auto_retry_start` for a given `message_end(stopReason:"error")` BEFORE the `agent_end` for the same session reaches the dashboard wire. The retry tracker's per-session attempt counter and the usage-limit orderer's per-session pending flag SHALL be updated synchronously when the bridge processes the originating `message_end`, BEFORE the bridge's `message_end` handler returns control to pi.

The actual `connection.send` for the `message_end` body MAY be deferred (per the existing pi 0.69+ entryId-capture deferral introduced by `fix-per-message-fork`), but the synthesizer state-machine update MUST run synchronously. This guarantees that when pi fires `agent_end` immediately after `message_end` (synchronous back-to-back, as observed in pi-coding-agent `agent-session.js:298–331`), the bridge's `agent_end` handler sees the up-to-date tracker / orderer state.

#### Scenario: Synthesizer state updated synchronously on message_end

- **GIVEN** the bridge's `message_end` handler is invoked with an assistant `stopReason:"error"` and a retryable `errorMessage`
- **WHEN** the handler returns
- **THEN** `retryTracker.isRetrying(sessionId)` SHALL return `true`
- **AND** `usageLimitOrderer.hasPending(sessionId)` SHALL return `true`
- **AND** this SHALL be true regardless of whether the deferred `connection.send` for the message_end body has fired yet

#### Scenario: agent_end fired back-to-back observes pending retry

- **GIVEN** pi fires `message_end(stopReason:"error", errorMessage:"429 too many requests")` immediately followed by `agent_end` in the same event-loop tick (no await between them)
- **WHEN** the bridge processes both events
- **THEN** the wire SHALL receive the synthesized `auto_retry_start` BEFORE the `agent_end` event
- **AND** the bridge SHALL NOT forward an `agent_end` whose `usageLimitOrderer.maybeSynthesize` returned null solely because `noteRetryStart` had not yet run

#### Scenario: Usage-limit error fires synthesized end before agent_end via wire-order invariant

- **GIVEN** pi fires `message_end(stopReason:"error", errorMessage:"...exceeded its monthly spending cap...")` immediately followed by `agent_end` carrying the same error
- **WHEN** the bridge processes both events
- **THEN** the wire SHALL receive in order: synthesized `auto_retry_start`, synthesized `auto_retry_end{success:false,finalError}`, then `agent_end`
- **AND** the dashboard reducer SHALL transition from `(retryState=undefined, lastError=undefined)` through `(retryState={…}, lastError=undefined)` to `(retryState=undefined, lastError={…})` with no intermediate state where both are simultaneously set

### Requirement: Reducer drops auto_retry_start when lastError is fresh same-turn

The reducer's `auto_retry_start` arm SHALL drop the incoming event (no `retryState` mutation, no other state change) when ALL of the following are true:

- `state.lastError` is currently set
- `state.lastError.timestamp` is within `1500` ms of `event.timestamp`
- `state.isStreaming === false`

This is a defense-in-depth safeguard against any future ordering regression in the bridge: if `auto_retry_start` ever arrives AFTER a `lastError` has already been set for the current terminal turn, the reducer SHALL NOT enter a `(retryState=set, lastError=set)` state for that turn.

The guard SHALL NOT fire when `state.lastError` is older than the threshold (carry-over from a prior turn) NOR when `state.isStreaming === true` (a fresh turn that retried after `agent_start` already cleared `lastError` is the existing intended UX).

#### Scenario: auto_retry_start dropped when lastError is from current terminal turn

- **GIVEN** `state.lastError = { message: "...quota exhausted...", timestamp: 1_000_000 }`
- **AND** `state.isStreaming === false`
- **AND** `state.retryState === undefined`
- **WHEN** an `auto_retry_start` event arrives with `timestamp: 1_000_500` (500 ms later)
- **THEN** `state.retryState` SHALL remain `undefined`
- **AND** `state.lastError` SHALL remain unchanged

#### Scenario: auto_retry_start NOT dropped when lastError is stale carryover

- **GIVEN** `state.lastError = { message: "earlier turn", timestamp: 1_000_000 }`
- **AND** `state.isStreaming === false`
- **WHEN** an `auto_retry_start` event arrives with `timestamp: 1_010_000` (10 s later, past the 1500 ms window)
- **THEN** `state.retryState` SHALL be set to the new retry record (existing behavior preserved)

#### Scenario: auto_retry_start NOT dropped when streaming

- **GIVEN** `state.lastError` is set and recent
- **AND** `state.isStreaming === true` (a new turn began, which would have cleared lastError on agent_start, but for some flow lastError lingers)
- **WHEN** an `auto_retry_start` event arrives
- **THEN** `state.retryState` SHALL be set (the streaming flag overrides the guard)

#### Scenario: auto_retry_start NOT dropped when lastError is undefined

- **GIVEN** `state.lastError === undefined`
- **WHEN** an `auto_retry_start` event arrives at any timestamp
- **THEN** `state.retryState` SHALL be set normally

