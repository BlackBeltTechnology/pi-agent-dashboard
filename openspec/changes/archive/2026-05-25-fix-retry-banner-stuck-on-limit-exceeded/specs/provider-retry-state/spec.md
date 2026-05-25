## ADDED Requirements

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

## MODIFIED Requirements

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
