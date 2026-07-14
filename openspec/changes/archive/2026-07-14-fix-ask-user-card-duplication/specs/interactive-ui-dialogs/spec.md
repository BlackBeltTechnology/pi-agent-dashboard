## MODIFIED Requirements

### Requirement: ask_user Tool Call Rendering

`ToolCallStep` SHALL NOT render `ask_user` tool calls using interactive renderers. The
interactive UI for ask_user questions SHALL be rendered exclusively by the
`interactiveUi` message created from `extension_ui_request`.

When a live `interactiveUi` message is present for the same question — identified by a
shared `toolCallId` — the `ask_user` tool card SHALL NOT be rendered at all. The
`interactiveUi` message SHALL be the single card for that question, avoiding a
duplicated title/description.

When NO paired `interactiveUi` message is present (e.g. history reload, where the
server replays only pending prompts and an already-answered `ask_user` has no live
`interactiveUi` message), `ToolCallStep` SHALL render the `ask_user` tool card as the
sole surviving record of the question and its answer.

#### Scenario: paired interactive card suppresses the tool card

- **WHEN** the message list contains a `toolResult` with `toolName: "ask_user"` and
  `toolCallId: t1` AND an `interactiveUi` message with matching `toolCallId: t1`
- **THEN** the `ask_user` tool card SHALL NOT be rendered
- **AND** the `interactiveUi` message SHALL be the only card for that question

#### Scenario: answered prompt on history reload keeps the tool card

- **WHEN** the message list contains a `toolResult` with `toolName: "ask_user"` and NO
  `interactiveUi` message shares its `toolCallId`
- **THEN** `ToolCallStep` SHALL render the `ask_user` tool card with its reconstructed
  answer summary

#### Scenario: Interactive UI request appears in chat

- **WHEN** an `extension_ui_request` message is received for an ask_user dialog
- **THEN** a single `interactiveUi` message SHALL be rendered with the appropriate
  `InteractiveRenderer`
- **AND** this SHALL be the only interactive card for that question
