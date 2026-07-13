## MODIFIED Requirements

### Requirement: Error extraction from agent_end events

The event reducer SHALL inspect `agent_end` events for error information. When `data.messages` contains a final assistant message with `stopReason === "error"`, the reducer SHALL set `lastError` on `SessionState` with the `errorMessage` value and the event timestamp.

`lastError` SHALL be set primarily via two paths:

1. **`agent_end` extractor**: when pi-coding-agent has fully exhausted its auto-retry attempts AND the terminal assistant message reaches `agent_end` with `stopReason: "error"` AND a non-empty `errorMessage`.

2. **`auto_retry_end` arm with `finalError`**: when the bridge forwards a synthesized `auto_retry_end { success: false, finalError: <string> }` AND `SessionState.lastError` is currently undefined. This covers the observe-based tracker's terminal synth (an error `agent_end` after an observed retry chain, forwarded before `agent_end` per the wire-ordering invariant).

There SHALL be NO usage-limit / `USAGE_LIMIT_PATTERN` synth source. Billing / quota errors are ordinary errors: they reach `lastError` via path (1) or (2) with no special classification, and the `SessionBanner` renders them as an ordinary settled error (no `limit-exceeded` variant — see `session-status-banner`).

The command-handler's synth on user abort does not carry a `finalError` field. Subsequent `agent_end` events surface the real provider error via path (1) when pi emits `stopReason: "error"` with the real `errorMessage`.

Transient retryable errors that pi-coding-agent retries internally SHALL NOT set `lastError` while the retry is in flight; they are surfaced via `SessionState.retryState` instead (see `provider-retry-state`). Once pi settles with a terminal `agent_end` error, `lastError` is set via path (1).

#### Scenario: LLM provider returns quota exceeded error after retries exhausted
- **WHEN** an `agent_end` event arrives with the last message having `stopReason: "error"` and `errorMessage: "Rate limit exceeded"`
- **THEN** `SessionState.lastError` SHALL be set to `{ message: "Rate limit exceeded", timestamp: <event timestamp> }`
- **AND** `SessionState.status` SHALL be `"idle"`
- **AND** `SessionState.isStreaming` SHALL be `false`
- **AND** `SessionState.retryState` SHALL be cleared

#### Scenario: agent_end without error
- **WHEN** an `agent_end` event arrives with the last message having `stopReason: "end_turn"` (normal completion)
- **THEN** `SessionState.lastError` SHALL remain unchanged (not set)

#### Scenario: agent_end with missing or empty messages array
- **WHEN** an `agent_end` event arrives with no `messages` array or an empty array
- **THEN** `SessionState.lastError` SHALL remain unchanged (defensive fallback)

#### Scenario: Billing error is an ordinary settled error (no limit-exceeded)
- **WHEN** an `agent_end` arrives with `stopReason: "error"` and `errorMessage: "usage_limit_reached: monthly cap"`
- **THEN** `SessionState.lastError` SHALL be set to `{ message: "usage_limit_reached: monthly cap", timestamp: <event.timestamp> }`
- **AND** NO `USAGE_LIMIT_PATTERN` test SHALL be performed anywhere in the reducer
- **AND** the `SessionBanner` SHALL render the ordinary settled-error card (NOT a `limit-exceeded` variant)

#### Scenario: User abort no longer sets lastError to "Aborted by user"
- **WHEN** the user aborts a retry-in-flight session
- **AND** the bridge synthesizes `auto_retry_end { success: false, attempt: -1 }` with NO `finalError`
- **THEN** `SessionState.lastError` SHALL NOT be set by this synth (reducer requires `typeof data.finalError === "string"`)
- **AND** if pi subsequently emits `agent_end` with a real provider `errorMessage`, `lastError` SHALL be set to that real message
- **AND** if pi does not emit `agent_end` with `stopReason: "error"`, `lastError` SHALL remain undefined and the unified banner SHALL transition to `hidden`

#### Scenario: auto_retry_end with finalError populates lastError early when undefined
- **WHEN** `SessionState.lastError` is undefined
- **AND** an `auto_retry_end` event arrives with `data: { success: false, finalError: "Rate limit exceeded" }`
- **THEN** `SessionState.lastError` SHALL be set to `{ message: "Rate limit exceeded", timestamp: <event.timestamp> }`

#### Scenario: auto_retry_end finalError does not overwrite existing lastError
- **WHEN** `SessionState.lastError` is already set to a previous error
- **AND** an `auto_retry_end` event arrives with `success: false` and a `finalError`
- **THEN** `SessionState.lastError` SHALL NOT be overwritten
