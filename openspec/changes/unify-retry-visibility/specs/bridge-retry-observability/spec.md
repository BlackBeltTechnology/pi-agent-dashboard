# bridge-retry-observability delta

## MODIFIED Requirements

### Requirement: Synthesize retry lifecycle from observed events

The bridge SHALL determine whether an observed turn failed by inspecting the
last message in `agent_end.data.messages` whose `role` is `"assistant"`, located
by scanning the array backward from the end. It SHALL NOT assume the final array
element is the assistant message.

This mirrors pi's own `_willRetryAfterAgentEnd` predicate, so the bridge's
belief about whether a retry will occur cannot diverge from pi's actual
behavior. The determination SHALL be structural — keyed on `role` and
`stopReason` — and SHALL NOT inspect error message text.

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
