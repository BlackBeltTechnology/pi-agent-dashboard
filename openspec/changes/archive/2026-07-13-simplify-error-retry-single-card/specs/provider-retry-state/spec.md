## MODIFIED Requirements

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

## REMOVED Requirements

### Requirement: Bridge auto-aborts session on USAGE_LIMIT_PATTERN match in message_end

**Reason**: `USAGE_LIMIT_PATTERN` regex classification is removed. Billing / quota failures are no longer special-cased; they flow through pi's ordinary non-retryable path and settle as a plain error.

**Migration**: No bridge auto-abort on billing strings. pi's own `_isRetryableError` does not match billing errors, so pi ends the turn promptly on its own; the dashboard surfaces the resulting terminal `agent_end` error as an ordinary settled error.

### Requirement: Bridge synthesizes auto_retry_end on agent_end USAGE_LIMIT match outside retry chain

**Reason**: Depends on the removed `USAGE_LIMIT_PATTERN`. The first-attempt terminal-limit synth branch no longer exists.

**Migration**: A first-attempt terminal billing error reaches the reducer via the ordinary `agent_end` extractor (`error-detection` path 1) as a plain error; no usage-limit synth is required.

### Requirement: Bridge usage-limit orderer cleans retry-banner → error-banner transition

**Reason**: The usage-limit orderer's billing path depends on `USAGE_LIMIT_PATTERN`. With no `limit-exceeded` variant, there is no billing-specific retry→error ordering to clean.

**Migration**: Ordinary retry→error transitions are handled by the observe-based tracker's `auto_retry_end { success:false, finalError }` on terminal `agent_end` error, forwarded before `agent_end` per the existing wire-ordering invariant. The `usage-limit-orderer.ts` billing branch is deleted.
