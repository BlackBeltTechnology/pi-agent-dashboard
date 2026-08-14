# provider-retry-state Specification

## Purpose
TBD - created by archiving change fix-provider-retry-infinite-loop. Update Purpose after archive.
## Requirements
### Requirement: Reducer tracks in-flight retry state

The event reducer SHALL maintain a `retryState` field on `SessionState` describing the current
retry, covering BOTH an in-flight attempt and the wait between attempts. The field SHALL be set
on the waiting signal and on `auto_retry_start`, and cleared on `auto_retry_end`, `agent_start`,
and `agent_settled`.

`agent_end` SHALL NOT clear `retryState`, because pi fires one `agent_end` per attempt and only
`agent_settled` is terminal. Clearing on `agent_end` would erase the retry state between every
attempt.

The shape SHALL be:
```ts
retryState?: {
  attempt: number;        // 1-based
  maxAttempts: number;    // pi's retry.maxRetries; 0 = unknown
  delayMs: number;        // computed from pi's settings; 0 = unknown
  nextAttemptAt?: number; // absolute epoch ms of the next attempt when known
  waiting: boolean;       // true between attempts, false while an attempt is in flight
  reason: string;         // errorMessage that triggered this retry
  startedAt: number;      // event.timestamp when this retry record was set
}
```

There is no `phase` discriminator: the dashboard runs no retry loop of its own, so pi's is the
only retry that exists.

**Runtime status only.** `retryState` describes what is happening *now* — waiting, which attempt,
when the next attempt lands. It SHALL NOT carry, and no session surface SHALL render, pi's retry
POLICY values (`baseDelayMs`, the provider sub-block, or any editable knob). `maxAttempts` is
retained solely to suppress a spurious waiting signal on the final attempt and SHALL NOT be rendered
as a denominator. pi has no persisted per-session retry policy
(`setAutoRetryEnabled` → the global setter), so no session surface SHALL present a per-session or
project-scoped retry editor; policy is edited only in the global surface (capability
`pi-retry-settings`).

#### Scenario: auto_retry_start sets an in-flight retryState

- **WHEN** an `auto_retry_start` event arrives with `data: { attempt: 2, maxAttempts: 3, delayMs: 4000, errorMessage: "rate limit exceeded" }`
- **THEN** `SessionState.retryState` SHALL equal `{ attempt: 2, maxAttempts: 3, delayMs: 4000, waiting: false, reason: "rate limit exceeded", startedAt: <event.timestamp> }`
- **AND** `SessionState.lastError` SHALL remain unchanged

#### Scenario: Waiting signal sets a waiting retryState

- **WHEN** a waiting signal arrives with `data: { attempt: 2, delayMs: 4000, nextAttemptAt: 1700000004000, errorMessage: "overloaded" }`
- **THEN** `SessionState.retryState.waiting` SHALL be `true`
- **AND** `SessionState.retryState.attempt` SHALL be `2`
- **AND** `SessionState.retryState.nextAttemptAt` SHALL be `1700000004000`

#### Scenario: agent_end preserves the retry state

- **GIVEN** `retryState` is set with `waiting: true`
- **WHEN** an `agent_end` event arrives
- **THEN** the existing `lastError` extraction logic SHALL run
- **AND** `SessionState.retryState` SHALL remain set

#### Scenario: agent_settled clears the retry state

- **GIVEN** `retryState` is set
- **WHEN** an `agent_settled` event arrives
- **THEN** `SessionState.retryState` SHALL be cleared to undefined

#### Scenario: auto_retry_end with success clears retryState

- **WHEN** `retryState` is set AND an `auto_retry_end` arrives with `data: { success: true, attempt: 2 }`
- **THEN** `SessionState.retryState` SHALL be cleared to undefined
- **AND** `SessionState.lastError` SHALL remain unchanged

#### Scenario: auto_retry_end with failure clears retryState and sets lastError

- **WHEN** `auto_retry_end` arrives with `data: { success: false, attempt: 3, finalError: "Rate limit exceeded" }`
- **THEN** `SessionState.retryState` SHALL be cleared
- **AND** `SessionState.lastError` SHALL be set to `{ message: "Rate limit exceeded", timestamp: <event.timestamp> }`

#### Scenario: agent_start defensively clears stale retryState

- **WHEN** `retryState` is set (e.g. session reload mid-retry) AND an `agent_start` arrives
- **THEN** `SessionState.retryState` SHALL be cleared to undefined

#### Scenario: auto_retry_end ignored when retryState is undefined

- **WHEN** `SessionState.retryState` is undefined AND an `auto_retry_end` event arrives
- **THEN** `SessionState.retryState` SHALL remain undefined
- **AND** `SessionState.lastError` SHALL NOT be modified by this event

### Requirement: Session card amber dot during retry

A session card in the sidebar SHALL render an amber (working-token) pulsing status mark whenever
its `SessionState.retryState` is set AND `SessionState.lastError` is undefined, in both the
waiting and in-flight sub-states. This visual SHALL be distinct from the red error mark and the
default idle/streaming/ended marks, and SHALL carry a non-hue channel (a shape/icon marker) so
it is distinguishable without colour.

The live COUNTDOWN is surfaced on the `SessionBanner`, NOT on every sidebar card: duplicating a
per-second countdown onto each card would require a timer in a render-hot component. The card
DOES carry the static attempt NUMBER in its activity slot — see `session-card-status`,
*Session card surfaces the in-flight retry attempt* — which needs no timer.

This paragraph previously excluded the attempt number from the card as well, which made a retry
unrepresentable there by construction.

#### Scenario: Amber mark during retry (both sub-states)

- **WHEN** the session has `retryState` set and `lastError` is undefined
- **THEN** the session card status mark SHALL be the amber working token, pulsing

#### Scenario: Red error mark wins over amber

- **WHEN** the session has both `retryState` set AND `lastError` set
- **THEN** the session card status mark SHALL be red (lastError takes precedence)

#### Scenario: Mark returns to default after retry clears

- **WHEN** `retryState` is cleared (success or stop) AND `lastError` is undefined
- **THEN** the session card status mark SHALL return to its non-error default

#### Scenario: No policy values on any session surface

- **WHEN** any session surface renders a retry (banner, collapsed pill, or sidebar card)
- **THEN** it SHALL NOT display `baseDelayMs`, `retry.provider.*`, or any other editable policy value
- **AND** it SHALL NOT offer a control that edits retry policy

#### Scenario: Marking uses an MDI mark, never an emoji

- **WHEN** a retry is marked on any surface
- **THEN** the mark SHALL be an MDI icon / token-driven indicator
- **AND** no emoji SHALL be used

### Requirement: Bridge synthesizes auto_retry_start from observed message_end

The bridge SHALL maintain a per-session retry tracker. Retry detection SHALL be derived from
OBSERVED pi behavior, NOT from a regex classifier. The bridge SHALL NOT test any
`RETRYABLE_PATTERN` / copy of pi's internal `_isRetryableError`.

The observed sequence is one full `agent_start` … `agent_end` cycle per attempt, terminated by
a single `agent_settled`. An error `agent_end` therefore means "another attempt is coming" and
SHALL produce both `auto_retry_start` for the completed attempt and a waiting signal; only
`agent_settled` terminates the chain. See capability `bridge-retry-observability` for the full
rules.

`maxAttempts` and `delayMs` SHALL be derived read-only from pi's retry settings, defaulting to
`3` and `2000`, and SHALL be `0` when the settings cannot be read. The `-1` sentinels are
REMOVED. The bridge SHALL NOT write pi's settings.

#### Scenario: Error agent_end triggers synthesized retry events

- **GIVEN** the bridge forwarded a `message_end` with `stopReason: "error"` and
  `errorMessage: "overloaded"`
- **WHEN** the matching `agent_end` is observed and no `agent_settled` terminates the chain
- **THEN** the bridge SHALL forward an `event_forward` with
  `event.eventType === "auto_retry_start"`
- **AND** the synthesized event SHALL have `data.attempt >= 1`, `data.maxAttempts === 3`,
  `data.delayMs > 0`, `data.errorMessage === "overloaded"`

#### Scenario: Waiting signal covers pi's sleep

- **GIVEN** the bridge observed an error `agent_end`
- **WHEN** pi is sleeping before the next attempt
- **THEN** the dashboard SHALL have received a waiting signal for that session
- **AND** the surface SHALL show a pending retry rather than a silent settled error

#### Scenario: Successful message_end clears the tracker and synthesizes auto_retry_end

- **GIVEN** the bridge previously synthesized `auto_retry_start` for session X
- **WHEN** the bridge forwards a subsequent `message_end` with `stopReason: "end_turn"`
- **THEN** the bridge SHALL forward a synthesized `auto_retry_end { success: true, attempt: <last attempt> }`
- **AND** the retry tracker SHALL clear its in-flight flag for session X

### Requirement: Automatic continuation closes the observed retry chain on assistant recovery

The bridge SHALL treat pi's automatic continuation after a retry as the next attempt even when no new user message exists. After an errored attempt has armed a retry chain, the first non-error assistant completion from the continued attempt SHALL close that chain successfully. Detection SHALL use typed live events and structural message fields; it SHALL NOT inspect session transcript JSON or match error text.

#### Scenario: Pi resumes automatically and succeeds

- **GIVEN** an assistant completion ended with `stopReason: "error"` and the observed retry chain is active
- **AND** pi starts the next attempt without a new user message
- **WHEN** that attempt emits an assistant completion whose `stopReason` is not `"error"` or `"aborted"`
- **THEN** the bridge SHALL emit one successful retry-end event for the active chain
- **AND** the chain SHALL no longer be active

#### Scenario: Another errored completion does not close the chain

- **GIVEN** an observed retry chain is active
- **WHEN** the next assistant completion has `stopReason: "error"`
- **THEN** the bridge SHALL retain the chain for a later attempt or terminal settle
- **AND** it SHALL NOT emit a successful retry-end event

#### Scenario: Aborted completion is not recovery

- **GIVEN** an observed retry chain is active
- **WHEN** an assistant completion has `stopReason: "aborted"`
- **THEN** the bridge SHALL NOT classify it as successful recovery
- **AND** no new retry SHALL be armed from the abort

#### Scenario: Terminal settle after exhaustion remains failed

- **GIVEN** every observed attempt in the active chain ended with an error
- **WHEN** pi emits the terminal settle event
- **THEN** the bridge SHALL close the chain as failed with the last provider error
- **AND** it SHALL NOT emit a successful retry-end event

#### Scenario: Floor compatibility settle does not close a multi-attempt chain

- **GIVEN** a pi version without native `agent_settled` emits one compatibility settle after each `agent_end`
- **AND** another retry attempt is armed
- **WHEN** the compatibility settle is forwarded to the client
- **THEN** it SHALL carry `retryPending: true`
- **AND** the bridge retry tracker and client retry state SHALL remain active for the next attempt

#### Scenario: Floor armed attempt never starts

- **GIVEN** floor pi emitted an errored `agent_end` that armed attempt N
- **AND** the compatibility settle preserved the pending retry state
- **WHEN** attempt N has not started after the observed retry delay plus grace
- **THEN** the bridge SHALL close only the still-matching armed chain as failed with its retained provider error
- **AND** it SHALL forward an unmarked terminal settle so the client exposes Retry and X

#### Scenario: Terminal settle without a new assistant disposition uses the retained failure

- **GIVEN** an active chain retained a provider error from its last failed attempt
- **AND** no later non-error or aborted assistant completion was observed
- **WHEN** pi emits the terminal settle event without assistant messages
- **THEN** the bridge SHALL close the chain as failed with the retained provider error
- **AND** the dashboard SHALL be able to leave retrying and render a settled dismissible error

### Requirement: Bridge synthesizes auto_retry_end on user abort

The bridge command handler SHALL synthesize and forward an `auto_retry_end` event immediately after invoking `cachedCtx.abort()` on receipt of an `abort` command. The synthesized event SHALL be forwarded via the existing `event_forward` wire shape so the dashboard can terminate the observed retry lifecycle optimistically.

The synthesized payload SHALL be `data: { success: false, attempt: -1 }` and SHALL omit `finalError`. Attempt `-1` SHALL identify user abort rather than provider exhaustion. The abort SHALL clear the bridge retry tracker for the session so a delayed wake-up, assistant completion, attempt end, or settle from the cancelled chain cannot emit a new retry-start, waiting, or terminal retry event.

The synthetic event SHALL be idempotent. Aborting outside a retry phase SHALL remain harmless.

#### Scenario: Abort during retry ends the observed lifecycle immediately

- **GIVEN** a session has an active observed retry chain
- **WHEN** the bridge receives `{ type: "abort", sessionId }`
- **THEN** the bridge SHALL invoke `cachedCtx.abort()`
- **AND** it SHALL forward `auto_retry_end` with `{ success: false, attempt: -1 }`
- **AND** `finalError` SHALL be absent
- **AND** the retry tracker SHALL no longer hold an active chain for the session

#### Scenario: Late events from an aborted chain do not reopen retrying

- **GIVEN** the bridge processed a user abort for an active retry chain
- **WHEN** delayed events from that cancelled chain arrive before the next explicit run
- **THEN** the bridge SHALL NOT synthesize a new retry-start or waiting event
- **AND** it SHALL NOT synthesize a terminal provider error for the cancelled chain

#### Scenario: Abort outside retry phase is harmless

- **GIVEN** a session has no active observed retry chain
- **WHEN** the bridge receives `abort`
- **THEN** the idempotent abort retry-end event MAY be forwarded
- **AND** no retry SHALL be started or scheduled

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

### Requirement: Retry banner in chat view is observe-only

The dashboard SHALL surface retries via the unified `SessionBanner` component (see capability
`session-status-banner`) whenever `SessionState.retryState` is set, covering both the waiting
and in-flight sub-states.

The surface SHALL display:

- **Attempt phrasing.** The attempt number SHALL be rendered bare ("attempt 7"). The surface
  SHALL NEVER render "of N": `maxRetries` is user-configurable and typically large, so a
  denominator is noise rather than information.
- **Countdown.** When `nextAttemptAt` is known the surface SHALL render a live countdown to it,
  refreshed at least once per second and never below 0. When only `delayMs > 0` is known the
  surface SHALL render a countdown to `startedAt + delayMs`, and SHALL switch to
  "still waiting… (N s elapsed)" once that instant has passed while the retry is still pending.
  When `delayMs` is 0 the surface SHALL render elapsed-only.
- The originating `reason` string.

The surface SHALL NOT render a "Stop retrying" control. Ending pi's retry chain is done through
the always-present session Stop, not through the banner.

#### Scenario: Waiting state shows an exact countdown

- **WHEN** `retryState = { attempt: 7, maxAttempts: 100, delayMs: 60000, nextAttemptAt: <now + 42s>, waiting: true, reason: "overloaded", startedAt: <now> }`
- **THEN** the surface SHALL show a countdown of 42 s decreasing at least once per second
- **AND** the surface SHALL show "attempt 7" without "of"

#### Scenario: Overrun countdown degrades to elapsed

- **GIVEN** a `waiting: true` record whose countdown target has passed
- **WHEN** the retry is still pending
- **THEN** the surface SHALL render "still waiting… (N s elapsed)" instead of a zeroed countdown

#### Scenario: Zero delay renders elapsed-only

- **WHEN** `retryState.delayMs` is 0 and `nextAttemptAt` is absent
- **THEN** the surface SHALL render an elapsed-only waiting line with no countdown

#### Scenario: No Stop retrying control in the banner

- **GIVEN** the surface carries any `retryState`
- **THEN** the banner SHALL NOT render a "Stop retrying" control

#### Scenario: Surface persists across attempts

- **GIVEN** the surface is rendering a waiting retry for attempt 3
- **WHEN** attempt 4 starts and then fails
- **THEN** the surface SHALL remain visible throughout
- **AND** the attempt counter SHALL advance rather than resetting

### Requirement: Turn disposition reads the last assistant message

The reducer SHALL determine a turn's disposition — clean versus errored — from
the last message in `agent_end.data.messages` whose `role` is `"assistant"`,
located by scanning the array backward. Both `isCleanAgentEnd` and
`extractAgentEndError` SHALL use this rule, via one shared helper, so the two
cannot diverge.

The determination SHALL be structural (`role`, `stopReason`) and SHALL NOT match
on error message text.

#### Scenario: Successful turn ending with a trailing toolResult clears the error
- **GIVEN** `SessionState.lastError` is set from a previous failed attempt
- **AND** an `agent_end` arrives whose `messages` array ends with a `toolResult`
- **AND** the last `role: "assistant"` message has a `stopReason` other than `"error"`
- **THEN** the turn SHALL be treated as clean
- **AND** `SessionState.lastError` SHALL be cleared to undefined
- **AND** the error surface SHALL no longer render

#### Scenario: Failed turn ending with a trailing toolResult still extracts the error
- **GIVEN** an `agent_end` whose `messages` array ends with a `toolResult`
- **AND** the last `role: "assistant"` message has `stopReason: "error"`
- **THEN** `SessionState.lastError` SHALL be set from that assistant message
- **AND** the turn SHALL NOT be treated as clean

#### Scenario: Disposition helpers agree
- **WHEN** any `agent_end` payload is evaluated
- **THEN** `isCleanAgentEnd` returning `true` SHALL imply `extractAgentEndError` returns no error
- **AND** `isCleanAgentEnd` returning `false` because of an errored assistant message SHALL imply `extractAgentEndError` returns that error

#### Scenario: No assistant message present
- **GIVEN** an `agent_end` whose `messages` array contains no entry with `role: "assistant"`
- **THEN** `SessionState.lastError` SHALL remain unchanged
- **AND** no error SHALL be synthesized

### Requirement: Dismissing an error surface never mutates retry state

`SessionState.retryState` has two consumers: the error surface renders it, and
the command input derives its working state from it to decide whether the
session abort control is mounted. A view-level dismissal SHALL NOT write to it.

Collapsing or dismissing an error surface SHALL therefore leave
`SessionState.retryState` unchanged. Only retry lifecycle events
(`auto_retry_*`, `agent_start`, `agent_settled`) may clear it.

#### Scenario: Collapsing while retrying leaves retry state intact
- **GIVEN** a session whose state has `retryState` set at attempt 2
- **WHEN** the user collapses the error surface
- **THEN** `SessionState.retryState` SHALL remain set at attempt 2
- **AND** the session SHALL remain a member of the retry set

#### Scenario: Dismissing a settled error does not resurrect or clear retry state
- **GIVEN** a session with `lastError` set and `retryState` undefined
- **WHEN** the user dismisses the error surface
- **THEN** `SessionState.lastError` SHALL be cleared
- **AND** `SessionState.retryState` SHALL remain undefined

#### Scenario: The abort control survives a dismissal during a retry
- **GIVEN** a retry is pending and the session abort control is displayed
- **WHEN** the user collapses the error surface
- **THEN** the session abort control SHALL remain displayed

