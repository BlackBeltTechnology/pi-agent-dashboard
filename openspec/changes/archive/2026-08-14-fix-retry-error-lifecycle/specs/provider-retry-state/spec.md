## ADDED Requirements

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

## MODIFIED Requirements

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
