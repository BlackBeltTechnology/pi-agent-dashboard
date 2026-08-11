# bridge-retry-observability delta

## MODIFIED Requirements

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
- An `agent_end` whose last **assistant** message is an error SHALL be treated as **an attempt
  that ended with another one coming**, NOT as terminal. It SHALL emit `auto_retry_start` for that attempt
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

**The failed-turn predicate reads the last ASSISTANT message.** The bridge SHALL determine
whether an observed turn failed by inspecting the last message in `agent_end.data.messages`
whose `role` is `"assistant"`, located by scanning the array backward from the end. It SHALL
NOT assume the final array element is the assistant message — a turn can legitimately end with
a trailing `toolResult`, in which case a bare `messages[length - 1]` read misses the error and
the chain never arms, yielding no retry counting even though pi is retrying.

This mirrors pi's own `_willRetryAfterAgentEnd` predicate, so the bridge's belief about whether
a retry will occur cannot diverge from pi's actual behavior. The determination SHALL be
structural — keyed on `role` and `stopReason` — and SHALL NOT inspect error message text.

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

#### Scenario: Error turn ending with a trailing toolResult still arms the chain

- **GIVEN** an `agent_end` whose `messages` array ends with a `toolResult` entry
- **AND** the last entry with `role: "assistant"` carries `stopReason: "error"`
- **THEN** the bridge SHALL treat the turn as failed
- **AND** SHALL emit a waiting signal carrying the attempt number and computed delay
- **AND** SHALL NOT clear the session's pending failure or attempt counter

#### Scenario: Trailing non-assistant entries do not suppress attempt counting

- **GIVEN** a retry chain where every failed turn ends with a trailing `toolResult`
- **WHEN** three such turns are observed in sequence
- **THEN** the emitted attempt numbers SHALL be `2` then `3`
- **AND** at least one `auto_retry_start` SHALL be synthesized
- **AND** the attempt counter SHALL NOT remain at its initial value

#### Scenario: Clean turn ending with a trailing toolResult closes the chain

- **GIVEN** an active retry chain
- **AND** an `agent_end` whose last `role: "assistant"` message has a `stopReason` other than `"error"`
- **WHEN** the array's final element is a `toolResult`
- **THEN** the bridge SHALL treat the turn as successful
- **AND** SHALL close the chain successfully

#### Scenario: No assistant message present

- **GIVEN** an `agent_end` whose `messages` array contains no entry with `role: "assistant"`
- **THEN** the bridge SHALL NOT treat the turn as failed
- **AND** SHALL NOT emit a waiting signal
