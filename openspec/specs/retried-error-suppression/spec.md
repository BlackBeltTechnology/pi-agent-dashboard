# retried-error-suppression Specification

## Purpose

Identify transcript message ids whose full red error / running tool card is
visual duplication and MUST render collapsed. Three collapse cases: a failed
`toolResult` immediately superseded by a successful retry of the same tool; a
current-turn failed `toolResult` that duplicates an active error-lifecycle
surface; and a `running`/replayed `toolResult` paired with a still-`pending`
interactive prompt. All helpers are pure and return a `Set<string>` of
message ids; they never mutate the transcript.

## Requirements

### Requirement: Collapse errors superseded by a same-tool retry

The system SHALL scan the message array forward and mark a failed `toolResult`
as retried when the next blocking `toolResult` is a non-error result of the
same tool, so the chat view collapses it to a compact retry badge instead of a
full red error card. Genuine terminal errors SHALL NOT be marked.

#### Scenario: Failed tool immediately followed by a successful retry
- WHEN a `toolResult` with `toolStatus === "error"` and a non-empty `toolName`
  is followed — skipping `assistant`, `thinking`, `turnSeparator`, `rawEvent`,
  and `commandFeedback` messages — by a `toolResult` with the same `toolName`
  and `toolStatus !== "error"`
- THEN the failed message's `id` is added to the retried set

#### Scenario: Retry look-ahead crosses a non-tool boundary
- WHEN the next blocking message after the failed `toolResult` is any role
  other than `toolResult` (for example `user`, `bashOutput`, or `interactiveUi`)
- THEN the look-ahead aborts and the failed message's `id` is NOT added to the
  retried set

#### Scenario: Next result is a different tool
- WHEN the next `toolResult` after the failed one has a `toolName` different
  from the failed message's `toolName`
- THEN the look-ahead aborts and the failed message's `id` is NOT added

#### Scenario: Chained errors of the same tool
- WHEN the next `toolResult` of the same `toolName` also has
  `toolStatus === "error"`
- THEN the look-ahead aborts and the first failed message's `id` is NOT added
  (chained errors are not collapsed)

#### Scenario: Terminal error with no following result
- WHEN a failed `toolResult` reaches the end of the message array without a
  matching same-tool non-error `toolResult`
- THEN its `id` is NOT added to the retried set

### Requirement: Suppress the inline duplicate of an active error surface

The system SHALL guarantee a single red surface per session: while the
error-lifecycle surface is active for a failure, the inline chat stream SHALL
NOT render a second full red error card for that same current-turn failure.

#### Scenario: Active surface with a trailing failed tool
- WHEN `surfaceActive` is `true` and, walking the messages from the tail before
  any `user` boundary, the first encountered `toolResult` has
  `toolStatus === "error"`
- THEN that message's `id` is added to the suppressed set so the inline card
  collapses to a compact badge

#### Scenario: Surface inactive
- WHEN `surfaceActive` is `false`
- THEN the suppressed set is empty regardless of message content

#### Scenario: Active surface with no trailing failed tool
- WHEN `surfaceActive` is `true` but the current turn (messages after the last
  `user` message) contains no `toolResult` with `toolStatus === "error"`
- THEN the suppressed set is empty (for example a pure LLM/provider error with
  no failed tool card to duplicate)

### Requirement: Hide a running tool card duplicated by a pending prompt

The system SHALL hide a `toolResult` that is paired with a still-`pending`
interactive prompt, because the interactive card already shows the question and
buttons while the user has not yet answered.

#### Scenario: Tool result followed by a pending interactive prompt
- WHEN a `toolResult` is followed — skipping `assistant`, `thinking`,
  `turnSeparator`, `rawEvent`, and `commandFeedback` messages — by an
  `interactiveUi` message whose `args.status === "pending"`
- THEN the `toolResult`'s `id` is added to the hidden set, independent of the
  `toolResult`'s own `toolStatus`

#### Scenario: Replayed complete tool with a pending prompt
- WHEN a server restart replays the tool as a `complete` `toolResult` while its
  paired `interactiveUi` remains `args.status === "pending"`
- THEN the `toolResult`'s `id` is still added to the hidden set so both collapse
  to a single confirm card

#### Scenario: Prompt already answered
- WHEN the next non-skip message after the `toolResult` is an `interactiveUi`
  whose `args.status` is not `"pending"` (for example `resolved` or
  `cancelled`), or is not an `interactiveUi` at all
- THEN the `toolResult`'s `id` is NOT added to the hidden set
