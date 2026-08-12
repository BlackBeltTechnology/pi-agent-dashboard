# provider-retry-state delta

## ADDED Requirements

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
