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

The bridge SHALL maintain a per-session retry tracker. When pi emits `message_end` whose `message.role === "assistant"` AND `message.stopReason === "error"` AND `message.errorMessage` matches the pi-coding-agent retryable pattern (`overloaded`, `rate.?limit`, `too many requests`, `429`, `5\d\d`, `service.?unavailable`, `network.?error`, `connection.?error`, `connection.?(refused|lost)`, `fetch failed`, `socket hang up`, `terminated`, `timeout`, `retry delay` etc.), the bridge SHALL forward an additional synthesized `event_forward` with `eventType: "auto_retry_start"` and `data: { attempt: <1-based counter>, maxAttempts: -1, delayMs: -1, errorMessage: <observed errorMessage> }`. The synthesized event SHALL be forwarded immediately after the original `message_end`. The session SHALL be marked as in retry until cleared.

`maxAttempts: -1` and `delayMs: -1` are sentinels: pi does not expose its retry settings to extensions, so the dashboard SHALL render an indeterminate "retrying…" UI instead of a countdown.

#### Scenario: Retryable assistant error triggers synthesized auto_retry_start
- **WHEN** the bridge forwards a `message_end` with `message: { role: "assistant", stopReason: "error", errorMessage: "rate limit exceeded" }`
- **THEN** the bridge SHALL also forward an `event_forward` with `event.eventType === "auto_retry_start"`
- **AND** the synthesized event SHALL have `data.attempt >= 1`, `data.maxAttempts === -1`, `data.delayMs === -1`, `data.errorMessage === "rate limit exceeded"`

#### Scenario: Non-retryable assistant error does NOT synthesize
- **WHEN** the bridge forwards a `message_end` with `errorMessage: "prompt is too long: 300000 tokens > 200000 maximum"` (context overflow, not retryable)
- **THEN** no synthesized `auto_retry_start` SHALL be emitted

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

### Requirement: Bridge auto-aborts session on USAGE_LIMIT_PATTERN match in message_end

When the bridge observes a `message_end` event whose `message.role === "assistant"`, `message.stopReason === "error"`, and `message.errorMessage` matches `USAGE_LIMIT_PATTERN` (imported from `packages/shared/src/error-patterns.ts`), the bridge SHALL:

1. Invoke `cachedCtx.abort()` synchronously — this prevents pi from entering its retry sleep for a terminal billing/quota error that will not resolve regardless of retry attempts.
2. Forward a synthesized `auto_retry_end { success: false, attempt: -1, finalError: <errorMessage> }` event. This routes the unified `SessionBanner` directly to the `limit-exceeded` variant carrying the real provider error.

The auto-abort SHALL run BEFORE the bridge's existing `retryTracker.observeMessageEnd` synth logic. If `RETRYABLE_PATTERN` would also have matched the same `errorMessage` (e.g. providers that emit `"429: usage_limit_reached"`), the `USAGE_LIMIT_PATTERN` branch wins and the retry chain SHALL NOT start.

#### Scenario: Terminal usage-limit error aborts immediately on message_end
- **WHEN** the bridge processes a `message_end` with `message: { role: "assistant", stopReason: "error", errorMessage: "monthly_spending_cap exceeded for project X" }`
- **THEN** the bridge SHALL invoke `cachedCtx.abort()` synchronously
- **AND** the bridge SHALL forward `event_forward { event: { eventType: "auto_retry_end", data: { success: false, attempt: -1, finalError: "monthly_spending_cap exceeded for project X" } } }`
- **AND** no synthesized `auto_retry_start` SHALL be emitted for this message_end
- **AND** the dashboard SHALL render the `limit-exceeded` variant

#### Scenario: Transient rate-limit still retries
- **WHEN** the bridge processes a `message_end` with `errorMessage: "429: rate_limit; try again in 30s"` (matches `RETRYABLE_PATTERN` but NOT `USAGE_LIMIT_PATTERN`)
- **THEN** the bridge SHALL NOT invoke `cachedCtx.abort()`
- **AND** the bridge SHALL synthesize and forward `auto_retry_start` as today
- **AND** the dashboard SHALL render the `retrying` variant

#### Scenario: Combined string (429 + usage_limit) hard-stops
- **WHEN** the bridge processes a `message_end` with `errorMessage: "429: usage_limit_reached — monthly quota"`
- **AND** the string matches BOTH `RETRYABLE_PATTERN` (via "429") AND `USAGE_LIMIT_PATTERN` (via "usage_limit_reached")
- **THEN** `USAGE_LIMIT_PATTERN` SHALL take precedence
- **AND** the bridge SHALL invoke `cachedCtx.abort()` AND forward the terminal `auto_retry_end{success:false, finalError}`

### Requirement: Bridge synthesizes auto_retry_end on agent_end USAGE_LIMIT match outside retry chain

When the bridge processes an `agent_end` event whose terminal assistant message has `stopReason: "error"` AND `errorMessage` matches `USAGE_LIMIT_PATTERN`, the bridge SHALL forward a synthesized `auto_retry_end { success: false, attempt: -1, finalError: <errorMessage> }` BEFORE forwarding the `agent_end` — **regardless of whether the orderer's pending flag is set**.

This extends the existing "Bridge usage-limit orderer cleans retry-banner → error-banner transition" requirement to also cover the first-attempt-terminal case (where no `auto_retry_start` was ever fired because `RETRYABLE_PATTERN` did not match). Without this requirement, first-attempt terminal billing errors would surface as the generic `error` banner variant instead of `limit-exceeded`.

The orderer's existing `maybeSynthesize` covers the case where a retry chain WAS in flight; this requirement covers the case where it WASN'T. The two paths SHALL be mutually exclusive (if `maybeSynthesize` returned a non-null synth, this branch SHALL NOT also fire).

#### Scenario: First-attempt terminal error routes to limit-exceeded variant
- **GIVEN** the orderer's `pending` flag is false for the session (no retry chain ever started)
- **WHEN** `agent_end` arrives with `messages[last]: { stopReason: "error", errorMessage: "insufficient_quota" }`
- **THEN** the bridge SHALL forward `event_forward { event: { eventType: "auto_retry_end", data: { success: false, attempt: -1, finalError: "insufficient_quota" } } }` BEFORE forwarding the `agent_end`
- **AND** the dashboard's `lastError` SHALL be set via the auto_retry_end arm to `"insufficient_quota"`
- **AND** the unified `SessionBanner` SHALL render the `limit-exceeded` variant

#### Scenario: Non-USAGE_LIMIT agent_end error does NOT route to limit-exceeded
- **GIVEN** the orderer's `pending` flag is false for the session
- **WHEN** `agent_end` arrives with `messages[last]: { stopReason: "error", errorMessage: "tool execution failed: file not found" }`
- **THEN** no synthesized `auto_retry_end` SHALL be emitted from this branch
- **AND** the existing `agent_end` reducer arm SHALL set `lastError` to `"tool execution failed: file not found"`
- **AND** the unified `SessionBanner` SHALL render the `error` variant (not `limit-exceeded`)

#### Scenario: When orderer.maybeSynthesize already fired, this branch does not double-fire
- **GIVEN** the orderer's `pending` flag was true (retry chain in flight)
- **WHEN** `agent_end` arrives with `errorMessage` matching `USAGE_LIMIT_PATTERN`
- **THEN** the bridge SHALL forward the orderer's synth (existing behavior)
- **AND** this new branch SHALL NOT additionally synthesize a second `auto_retry_end` for the same `agent_end`

### Requirement: Bridge usage-limit orderer cleans retry-banner → error-banner transition

When the bridge observes an `agent_end` event whose terminal assistant message has `stopReason: "error"` and an `errorMessage` matching the broadened usage-limit pattern, AND the retry tracker reports an in-flight synthesized retry for that session, the bridge SHALL forward a synthesized `auto_retry_end { success: false, attempt: -1, finalError: <errorMessage> }` BEFORE forwarding the `agent_end` event.

The broadened pattern SHALL match all of the following terminal billing/quota error categories observed in production:

```
/usage[_ ]limit[_ ]reached
 |usage_not_included
 |insufficient_quota
 |credit[_ ]balance
 |quota[_ ]exceeded
 |resource[_ ]exhausted
 |monthly[_ ]limit
 |monthly[_ ]spending[_ ]cap
 |hourly[_ ]limit
 |daily[_ ]limit
 |spending[_ ]cap
 |exceeded[^"]{0,40}(quota|cap|spending)
 |reset after \d+[hms]/i
```

This SHALL NOT change pi-coding-agent's retry decisions; it only ensures the dashboard's `retryState` clears before `lastError` is set, avoiding a transient frame where both retry-banner and error-banner are visible.

#### Scenario: Usage-limit terminal error orders synthetic end before agent_end
- **GIVEN** the retry tracker reports an in-flight synthesized retry for session X
- **WHEN** an `agent_end` event arrives whose last message has `stopReason: "error"` and `errorMessage: "usage_limit_reached: 5000 RPM exceeded"`
- **THEN** the bridge SHALL forward a synthesized `auto_retry_end` with `success: false` and the error string
- **AND** the bridge SHALL forward the original `agent_end` immediately after

#### Scenario: Gemini monthly-spending-cap error matches broadened pattern
- **GIVEN** the retry tracker reports an in-flight synthesized retry for session X
- **WHEN** an `agent_end` event arrives whose last message has `stopReason: "error"` and `errorMessage` containing `"Your project has exceeded its monthly spending cap"` and `"RESOURCE_EXHAUSTED"` and HTTP code `429`
- **THEN** the bridge SHALL forward a synthesized `auto_retry_end` with `success: false` and the full error string
- **AND** the bridge SHALL forward the original `agent_end` immediately after

#### Scenario: OpenAI insufficient_quota matches broadened pattern
- **GIVEN** the retry tracker reports an in-flight synthesized retry for session X
- **WHEN** an `agent_end` event arrives whose last message has `errorMessage` containing `"insufficient_quota"`
- **THEN** the bridge SHALL forward a synthesized `auto_retry_end` with `success: false`

#### Scenario: Anthropic credit-balance error matches broadened pattern
- **GIVEN** the retry tracker reports an in-flight synthesized retry for session X
- **WHEN** an `agent_end` event arrives whose last message has `errorMessage` containing `"credit balance"` (e.g. `"Your credit balance is too low to access the API"`)
- **THEN** the bridge SHALL forward a synthesized `auto_retry_end` with `success: false`

#### Scenario: Non-usage-limit error skips synthesis
- **GIVEN** an `agent_end` arrives with `errorMessage: "tool execution failed"`
- **WHEN** the bridge processes it
- **THEN** no synthesized `auto_retry_end` SHALL be emitted
- **AND** the `agent_end` SHALL be forwarded unchanged

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

