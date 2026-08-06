# bridge-retry-observability Specification

## Purpose

pi-coding-agent owns its provider-retry policy and exposes NO `auto_retry_*` events to extensions. When a provider call fails with a retryable error, pi fires `message_end` for the failed assistant message, sleeps through a provider backoff (5–60 s), then starts a fresh assistant `message_start` for the next attempt — all inside a single agent turn. The dashboard bridge cannot subscribe to pi's internal retry lifecycle, so this capability RECONSTRUCTS it by OBSERVING the message/agent event sequence, synthesizes `auto_retry_start` / `auto_retry_end` events for the dashboard, and keeps a user abort effective across a long backoff that outlives the persistent-abort scheduler.

## Requirements

### Requirement: Synthesize retry lifecycle from observed events

The bridge SHALL synthesize `auto_retry_start` and `auto_retry_end` by observing pi's real
event sequence, never by predicting retries from error text.

**The observation model is corrected here.** pi does NOT keep a retry chain inside one agent
turn. Every attempt is a complete `agent_start` … `agent_end` cycle, and exactly one
`agent_settled` fires after the final `agent_end`. The prior model — "error `message_end`, then
a fresh assistant `message_start` in the same turn" — never matches, so the bridge synthesized
NOTHING and the retry surface was dead. The corrected rules are:

- An assistant `message_end` with `stopReason: "error"` SHALL record a pending failure for the
  session. It SHALL NOT clear the chain.
- An `agent_end` whose last message is an error SHALL be treated as **an attempt that ended
  with another one coming**, NOT as terminal. It SHALL emit `auto_retry_start` for that attempt
  and a **waiting signal**, and SHALL NOT clear the session's retry tracking.
- `agent_settled` SHALL be the SOLE terminal signal. It SHALL close the chain with
  `auto_retry_end` and clear all per-session retry tracking.

`maxAttempts` and `delayMs` SHALL be derived read-only from pi's retry settings
(`retry.maxRetries`, `retry.baseDelayMs`; defaults `3` and `2000` when absent), computing the
delay as `baseDelayMs · 2^(attempt-1)` — pi's own arithmetic. When the settings cannot be read
the bridge SHALL emit `delayMs: 0`, which the surface renders elapsed-only. The `-1` sentinels
are REMOVED. The bridge SHALL NOT write pi's settings.

**`agent_end.willRetry` SHALL NOT be relied upon.** pi 0.83 computes it, but only on the session
(RPC/SDK) channel: `agent-session.js` line 353 emits `{ ...event, willRetry }` to session listeners
while line 433 emits `{ type: "agent_end", messages }` to the extension runner, stripping it. The
extension-facing `AgentEndEvent` type is `{type, messages}`; the only `willRetry` in extension types
belongs to `session_before_compact` / `session_compact`. The bridge is an extension, so it SHALL
synthesize from `agent_end` + the following `agent_start` + `agent_settled` instead.

pi's predicate is
`settings.enabled && _retryAttempt < settings.maxRetries && _isRetryableError(lastAssistant)`. The
bridge SHALL honor the first two conditions (both settings-readable) when deciding whether to emit a
waiting signal, and SHALL NOT replicate `_isRetryableError` — duplicating pi's regex classifier is
forbidden. Retryability therefore remains observed, never predicted.

#### Scenario: Error agent_end emits a waiting signal instead of clearing the chain

- **WHEN** an `agent_end` whose last message has `stopReason: "error"` is observed for a session
- **THEN** the bridge SHALL emit a waiting signal carrying the attempt number, the computed
  `delayMs`, the `errorMessage`, and `nextAttemptAt` equal to the `agent_end` timestamp plus
  `delayMs`
- **AND** the bridge SHALL NOT clear the session's pending failure or attempt counter

#### Scenario: Regression — pi's real event order produces retry events

- **GIVEN** the observed sequence `agent_start → message_end(error) → agent_end` repeated three
  times, followed by `agent_settled`
- **WHEN** the bridge processes it
- **THEN** at least one `auto_retry_start` SHALL be synthesized
- **AND** exactly one `auto_retry_end` SHALL be synthesized

#### Scenario: Attempt counter increments across the chain

- **WHEN** a second error `agent_end` occurs for a session whose chain is already in flight
- **THEN** the emitted attempt number SHALL be incremented to the next value
- **AND** the emitted `delayMs` SHALL be `baseDelayMs · 2^(attempt-1)` for that attempt

#### Scenario: agent_settled closes the chain

- **GIVEN** a retry chain is in flight for a session
- **WHEN** `agent_settled` is observed
- **THEN** the bridge SHALL emit `auto_retry_end` exactly once
- **AND** all per-session retry tracking SHALL be cleared

#### Scenario: Delay and max attempts are computed, not sentinel

- **WHEN** a retry event is synthesized for attempt 2 with pi's defaults in force
- **THEN** `maxAttempts` SHALL be `3` and `delayMs` SHALL be `4000`
- **AND** neither field SHALL be `-1`

#### Scenario: Final attempt does not emit a spurious waiting signal

- **GIVEN** `retry.maxRetries` is `3` and the chain has reached attempt `3`
- **WHEN** the error `agent_end` for that attempt is observed
- **THEN** the bridge SHALL NOT emit a waiting signal, because no further attempt will follow

#### Scenario: Retry disabled suppresses the waiting signal entirely

- **GIVEN** `retry.enabled` is `false`
- **WHEN** an error `agent_end` is observed
- **THEN** the bridge SHALL NOT emit a waiting signal, because pi will not retry at all
- **AND** the error SHALL surface as an ordinary settled error

#### Scenario: willRetry is not consumed from agent_end

- **WHEN** the bridge processes an `agent_end`
- **THEN** it SHALL NOT read a `willRetry` field from that event, because the extension channel
  strips it
- **AND** it SHALL NOT test the error text against any retryable pattern

#### Scenario: Unreadable retry settings degrade to elapsed-only

- **WHEN** pi's retry settings cannot be read
- **THEN** the synthesized events SHALL carry `delayMs: 0`
- **AND** the surface SHALL render an elapsed-only waiting state rather than a countdown

#### Scenario: No regex gate on the error message

- **GIVEN** an error `message_end` with `errorMessage: "prompt is too long"` (a string pi will
  NOT retry)
- **WHEN** `agent_settled` follows immediately after the `agent_end`
- **THEN** the chain SHALL close as terminal — because no further attempt was observed, NOT
  because a regex rejected the string

### Requirement: Close the retry chain on success or terminal error

The bridge SHALL emit `auto_retry_end` exactly once per in-flight retry chain, distinguishing a
successful resolution from a terminal error, and SHALL emit nothing for a failure pi never
re-attempted. The terminal trigger is `agent_settled`, NOT `agent_end`, because `agent_end`
fires once per attempt.

#### Scenario: Retry resolves successfully

- **WHEN** a non-error assistant `message_end` closes an in-flight retry chain
- **THEN** the bridge emits `auto_retry_end` with `success: true` and the last attempt number
- **AND** clears the pending failure and the in-flight retry tracking for that session

#### Scenario: Retry chain ends with a terminal error

- **WHEN** `agent_settled` fires while a retry chain is in flight AND the last message has
  `stopReason: "error"`
- **THEN** the bridge emits `auto_retry_end` with `success: false`, the last attempt, and
  `finalError` carrying the terminal error message

#### Scenario: agent_settled with no in-flight chain emits nothing

- **WHEN** `agent_settled` fires and no retry chain was in flight for that session
- **THEN** the bridge synthesizes NO `auto_retry_end`, because a terminal error pi deemed
  non-retryable surfaces through the ordinary settled-error path

### Requirement: Forward synthetic retry events in the standard shape

The bridge SHALL forward each synthetic retry event to the dashboard using the standard `event_forward` envelope, and only while the bridge is the active instance and the session is ready.

#### Scenario: Synthetic event envelope

- WHEN a synthetic `auto_retry_start` or `auto_retry_end` is forwarded
- THEN the bridge sends an `event_forward` message carrying the `sessionId` and an `event` with `eventType`, a `timestamp`, and the synthesized `data`

#### Scenario: Suppressed when inactive

- WHEN a synthetic retry event would be forwarded but the bridge is no longer the active instance OR the session is not yet ready
- THEN nothing is sent

### Requirement: Latch a user abort across a long provider backoff

The bridge SHALL latch a user abort per session so an abort issued during a provider backoff
still stops pi. The latch operates as abort-on-sight scoped to the aborted turn, using "no
intervening user prompt" as the discriminator.

The latch is retained as defense-in-depth for interactive/TUI-attached sessions. For
dashboard-spawned `--mode rpc` sessions it is belt-and-braces only: `ctx.abort()` resolves to
`AgentSession.abort()`, which calls `abortRetry()` before `agent.abort()` and cancels the
backoff sleep directly — measured at 2 ms during a 16 s sleep.

#### Scenario: Abort latches before the abort call

- **WHEN** the bridge receives an `abort` command for a session
- **THEN** the latch SHALL be set for that session before `cachedCtx.abort()` is invoked

#### Scenario: Abort during a backoff stops the chain promptly

- **GIVEN** a session is sleeping between retry attempts
- **WHEN** the user aborts
- **THEN** the retry chain SHALL terminate without waiting for the remaining backoff
- **AND** the bridge SHALL close the chain with `auto_retry_end`

#### Scenario: Aborted turn resuming is aborted again

- **GIVEN** the latch is set for a session
- **WHEN** the bridge observes the aborted turn resuming with no intervening user prompt
- **THEN** the bridge SHALL call `cachedCtx.abort()` again to honor the latch

#### Scenario: Latch cleared by a new user prompt

- **WHEN** a NEW user prompt is dispatched for the session
- **THEN** the latch SHALL be cleared so the deliberate new turn is not killed

#### Scenario: Latch cleared on settle

- **WHEN** the aborted turn settles (`agent_settled` / idle)
- **THEN** the latch SHALL be cleared

### Requirement: Persistent-abort scheduler covers the short backoff window

The bridge SHALL, on a user abort, re-invoke a raw abort at fixed intervals for a bounded window to cover the gap between issuing the abort and pi installing a fresh retry abort controller, breaking early once the aborted turn ends.

#### Scenario: Repeated raw aborts within the window

- WHEN a user abort is issued
- THEN the bridge re-invokes a raw `cachedCtx.abort()` every 200 ms for up to 2 seconds
- AND uses the raw abort (not the full wrapper abort) so repeated ticks do not re-run queue clears and shadow resets that would clobber prompts sent within the window

#### Scenario: Scheduler stops when the turn ends

- WHEN the aborted turn's `agent_end` flips streaming to false during the scheduler window
- THEN the persistent-abort scheduler breaks early and stops re-issuing aborts
