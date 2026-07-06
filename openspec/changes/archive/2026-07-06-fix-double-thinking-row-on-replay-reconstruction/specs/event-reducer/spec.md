## MODIFIED Requirements

### Requirement: Reasoning rows reconstructed from message content on replay
The reducer SHALL build `role:"thinking"` rows from a finalized assistant
message's content blocks ONLY when the current assistant turn has no existing
`role:"thinking"` row. For each `message_end` whose `data.message.content`
contains `{ type: "thinking" }` blocks AND for which no thinking row was already
produced (by streaming `thinking_*` events), the reducer SHALL push one
`role:"thinking"` ChatMessage per non-empty block, reading the text from the
block's `thinking` field (falling back to `text`), with `streamedLive: false`.
Reconstructed rows SHALL be pushed before the assistant text row so a plain
`[thinking, text]` message renders reasoning first; tool-bearing messages SHALL
be positioned by the existing content-order reorder pass. The reducer SHALL NOT
reconstruct when a thinking row for the current turn already exists, regardless
of the `isLive` flag, so a streamed-then-finalized turn yields exactly one
thinking row.

This closes the gap where the cold-load path (`state-replay.ts`) emits no
`thinking_*` events, so reopened sessions previously showed no reasoning, while
avoiding a duplicate row when a live turn streamed reasoning and then finalized
via a `message_end` not flagged `isLive`. The reasoning text is present inline
in the persisted message content and requires no server round-trip.

#### Scenario: Reopened session rebuilds reasoning before the answer
- **GIVEN** a replayed `message_end` (no prior thinking row) whose
  `message.content` is
  `[{ type: "thinking", thinking: "R" }, { type: "text", text: "A" }]`
- **WHEN** the reducer processes it
- **THEN** `messages` SHALL contain a `role:"thinking"` row with content `"R"`
  immediately followed by a `role:"assistant"` row with content `"A"`
- **AND** the thinking row SHALL have `streamedLive: false`

#### Scenario: Multiple thinking blocks preserved in content order
- **GIVEN** a replayed `message_end` (no prior thinking row) whose
  `message.content` has thinking blocks `"First"` then `"Second"` followed by a
  text block
- **THEN** two `role:"thinking"` rows SHALL be created with content `"First"`
  then `"Second"`

#### Scenario: Streamed reasoning is not double-created
- **GIVEN** a turn that emitted `thinking_end` with content `"streamed
  reasoning"` (which pushed one `role:"thinking"` row)
- **WHEN** the terminal `message_end` arrives carrying the same
  `{ type: "thinking", thinking: "streamed reasoning" }` block in its content,
  whether or not `isLive` is set
- **THEN** exactly one `role:"thinking"` row SHALL exist (no duplicate)
