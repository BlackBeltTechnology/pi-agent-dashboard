## MODIFIED Requirements

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

### Requirement: Retry banner in chat view

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
- **A "Stop retrying" control** that aborts the session, thereby ending pi's retry chain.
- The originating `reason` string.

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

#### Scenario: Stop retrying aborts the session

- **GIVEN** the surface carries any `retryState`
- **WHEN** the user activates "Stop retrying"
- **THEN** an `abort` SHALL be dispatched for the session

#### Scenario: Surface persists across attempts

- **GIVEN** the surface is rendering a waiting retry for attempt 3
- **WHEN** attempt 4 starts and then fails
- **THEN** the surface SHALL remain visible throughout
- **AND** the attempt counter SHALL advance rather than resetting

### Requirement: Session card amber mark during retry

A session card in the sidebar SHALL render an amber (working-token) pulsing status mark whenever
its `SessionState.retryState` is set AND `SessionState.lastError` is undefined, in both the
waiting and in-flight sub-states. This visual SHALL be distinct from the red error mark and the
default idle/streaming/ended marks, and SHALL carry a non-hue channel (a shape/icon marker) so
it is distinguishable without colour.

The per-attempt number and countdown are surfaced on the `SessionBanner` (including its collapsed
pill), NOT on every sidebar card: duplicating a live countdown onto each card would require a
per-card timer in a render-hot component for information the banner already carries. The card's
job is only to mark "this session is retrying".

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

### Requirement: Bridge synthesizes auto_retry_start from observed events

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
