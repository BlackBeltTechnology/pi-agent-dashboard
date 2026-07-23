## ADDED Requirements

### Requirement: Custom display-message rendering
A session message with `role: "custom"` and a truthy `display` flag SHALL render
as a single assistant-side `ChatMessage`. The reducer SHALL build the row on the
`message_end` event (the `message_start` event for `role:"custom"` SHALL be a
no-op), SHALL use `role: "assistant"` for the built row, and SHALL derive
`content` from the message content (string content used directly; array content
concatenating `type:"text"` parts).

The built row SHALL be idempotent across re-replay: a row id stable for the source
entry SHALL be reused so re-processing the same custom message updates the row in
place rather than appending a duplicate.

Handling a `role:"custom"` message SHALL NOT advance `assistantInferenceSeq`,
SHALL NOT modify `streamingTextFlushed`, and SHALL NOT run the streaming-text
flush — those are exclusive to real assistant inferences. A `role:"custom"`
message whose `display` is falsy or absent SHALL NOT produce a row.

#### Scenario: Custom display message renders as an assistant row
- **WHEN** a `message_start` followed by a `message_end` arrives with `role: "custom"` and `display: true`
- **THEN** exactly one `ChatMessage` with `role: "assistant"` SHALL be added to `messages`
- **AND** its `content` SHALL be the custom message's text content

#### Scenario: Custom display message is built once across re-replay
- **WHEN** the same custom `message_start` / `message_end` pair is processed twice
- **THEN** `messages` SHALL contain exactly one row for that message (updated in place, not duplicated)

#### Scenario: Hidden custom message produces no row
- **WHEN** a `message_start` / `message_end` arrives with `role: "custom"` and `display` falsy or absent
- **THEN** no `ChatMessage` SHALL be added to `messages`

#### Scenario: Custom display message does not disturb assistant turns
- **WHEN** a custom display message is followed by a real assistant `message_end` carrying a `[text, toolCall]` content array
- **THEN** `assistantInferenceSeq` SHALL reflect only the real assistant inference
- **AND** the assistant message's tool-card reorder SHALL be unaffected by the custom row
