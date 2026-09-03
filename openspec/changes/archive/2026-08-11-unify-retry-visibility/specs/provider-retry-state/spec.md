# provider-retry-state delta

## MODIFIED Requirements

### Requirement: Session card amber dot during retry

A session card in the sidebar SHALL render an amber (working-token) pulsing status mark whenever
its `SessionState.retryState` is set AND `SessionState.lastError` is undefined, in both the
waiting and in-flight sub-states. This visual SHALL be distinct from the red error mark and the
default idle/streaming/ended marks, and SHALL carry a non-hue channel (a shape/icon marker) so
it is distinguishable without colour.

The live COUNTDOWN is surfaced on the `SessionBanner`, NOT on every sidebar card: duplicating a
per-second countdown onto each card would require a timer in a render-hot component. The card
DOES carry the static attempt NUMBER in its activity slot — see `session-card-status`,
*Session card surfaces the in-flight retry attempt* — which needs no timer.

This paragraph previously excluded the attempt number from the card as well, which made a retry
unrepresentable there by construction.

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
