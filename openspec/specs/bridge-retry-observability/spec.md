# bridge-retry-observability Specification

## Purpose

pi-coding-agent owns its provider-retry policy and exposes NO `auto_retry_*` events to extensions. When a provider call fails with a retryable error, pi fires `message_end` for the failed assistant message, sleeps through a provider backoff (5–60 s), then starts a fresh assistant `message_start` for the next attempt — all inside a single agent turn. The dashboard bridge cannot subscribe to pi's internal retry lifecycle, so this capability RECONSTRUCTS it by OBSERVING the message/agent event sequence, synthesizes `auto_retry_start` / `auto_retry_end` events for the dashboard, and keeps a user abort effective across a long backoff that outlives the persistent-abort scheduler.

## Requirements

### Requirement: Synthesize retry lifecycle from observed events

The bridge SHALL synthesize `auto_retry_start` and `auto_retry_end` events by observing pi's `message_start`, `message_end`, and `agent_end` sequence, never by predicting retries from error text. A retry is confirmed only when pi actually starts a fresh attempt; nothing is emitted on the failing message alone.

#### Scenario: Error message_end records a pending failure silently

- WHEN an assistant `message_end` with `stopReason` `error` is observed for a session
- THEN the bridge records the error message as a pending failure for that session
- AND emits NO synthetic event yet, because the retry is not yet confirmed

#### Scenario: Fresh attempt confirms a retry

- WHEN an assistant `message_start` is observed while a failure is pending for that session (no user prompt in between)
- THEN the bridge emits `auto_retry_start` with a 1-based `attempt` counter, `errorMessage` carrying the recorded failure text, and sentinel `maxAttempts` `-1` and `delayMs` `-1`
- AND clears the pending failure so the same failure is not re-counted

#### Scenario: Retry attempt counter increments across a chain

- WHEN a second error `message_end` then another assistant `message_start` occur in the same in-flight turn
- THEN the emitted `auto_retry_start` carries `attempt` incremented to the next value for that session

#### Scenario: Delay and max attempts are unknowable

- WHEN `auto_retry_start` is synthesized
- THEN `maxAttempts` and `delayMs` are `-1` sentinels, because pi's retry settings are not exposed to the extension

### Requirement: Close the retry chain on success or terminal error

The bridge SHALL emit `auto_retry_end` exactly once per in-flight retry chain, distinguishing a successful resolution from a terminal error, and SHALL emit nothing for a failure pi never re-attempted.

#### Scenario: Retry resolves successfully

- WHEN a non-error assistant `message_end` closes an in-flight retry chain
- THEN the bridge emits `auto_retry_end` with `success` `true` and the last `attempt` number
- AND clears the pending failure and the in-flight retry tracking for that session

#### Scenario: Retry chain ends with a terminal error

- WHEN `agent_end` fires while a retry chain is in flight AND the last message has `stopReason` `error`
- THEN the bridge emits `auto_retry_end` with `success` `false`, the last `attempt`, and `finalError` carrying the terminal error message
- AND this event is forwarded BEFORE `agent_end` so the dashboard clears the retry sub-line before the settled error renders

#### Scenario: agent_end with no in-flight chain emits nothing

- WHEN `agent_end` fires and no retry chain was in flight for that session
- THEN the bridge synthesizes NO `auto_retry_end`, because a terminal error pi deemed non-retryable surfaces through the ordinary settled-error `agent_end` path

#### Scenario: Non-error completion without an in-flight chain

- WHEN a non-error assistant `message_end` is observed and no retry chain is in flight
- THEN the bridge clears any stray pending failure and emits NO synthetic event

### Requirement: Forward synthetic retry events in the standard shape

The bridge SHALL forward each synthetic retry event to the dashboard using the standard `event_forward` envelope, and only while the bridge is the active instance and the session is ready.

#### Scenario: Synthetic event envelope

- WHEN a synthetic `auto_retry_start` or `auto_retry_end` is forwarded
- THEN the bridge sends an `event_forward` message carrying the `sessionId` and an `event` with `eventType`, a `timestamp`, and the synthesized `data`

#### Scenario: Suppressed when inactive

- WHEN a synthetic retry event would be forwarded but the bridge is no longer the active instance OR the session is not yet ready
- THEN nothing is sent

### Requirement: Latch a user abort across a long provider backoff

The bridge SHALL latch a user abort per session so that an abort issued during a long provider backoff — which outlives the 200 ms / 2 s persistent-abort scheduler — still stops pi when it wakes to resume the retry. The latch operates as abort-on-sight scoped to the aborted turn, using "no intervening user prompt" as the discriminator.

#### Scenario: Abort latches before the abort call

- WHEN a user abort arrives for a session
- THEN the bridge sets the abort latch for that session BEFORE invoking `cachedCtx.abort()`
- AND clears the retry attempt counter (via the tracker's abort note) so a subsequent `agent_end` does not double-emit `auto_retry_end` with `success` `true`

#### Scenario: Aborted turn resuming is aborted again

- WHEN the abort latch is set AND the bridge observes the aborted turn resuming — a fresh `agent_start`, or an assistant (non-user) `message_start` with no intervening user prompt
- THEN the bridge issues a fresh `cachedCtx.abort()` to honor the latch when pi wakes from its backoff

#### Scenario: New user prompt clears the latch

- WHEN a new user prompt is dispatched for the session (a user `message_start`, or send-prompt handling)
- THEN the bridge clears the abort latch so the user's deliberate new turn is never aborted

#### Scenario: Settled turn clears the latch

- WHEN the aborted turn settles at `agent_end`
- THEN the bridge clears the abort latch so a later, unrelated turn is not aborted

### Requirement: Persistent-abort scheduler covers the short backoff window

The bridge SHALL, on a user abort, re-invoke a raw abort at fixed intervals for a bounded window to cover the gap between issuing the abort and pi installing a fresh retry abort controller, breaking early once the aborted turn ends.

#### Scenario: Repeated raw aborts within the window

- WHEN a user abort is issued
- THEN the bridge re-invokes a raw `cachedCtx.abort()` every 200 ms for up to 2 seconds
- AND uses the raw abort (not the full wrapper abort) so repeated ticks do not re-run queue clears and shadow resets that would clobber prompts sent within the window

#### Scenario: Scheduler stops when the turn ends

- WHEN the aborted turn's `agent_end` flips streaming to false during the scheduler window
- THEN the persistent-abort scheduler breaks early and stops re-issuing aborts
