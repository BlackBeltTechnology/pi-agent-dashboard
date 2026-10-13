## MODIFIED Requirements

### Requirement: toolResult hidden during paired pending interactiveUi
The chat view SHALL hide (return `null` from the message renderer) any `toolResult` message whose very next non-skip message is an `interactiveUi` message with `args.status === "pending"`, regardless of the `toolResult`'s own `toolStatus`. Skip roles are the same as for the retry-pill helper (`assistant`, `thinking`, `turnSeparator`, `rawEvent`, `commandFeedback`).

The `toolStatus` is intentionally ignored because, after a server restart, the `toolResult` of a legitimately-pending `ask_user` can arrive terminal (a cold transcript replay or an older bridge synthesizes an orphan `tool_execution_end`) or `"running"` (a live bridge replay leaves the in-flight call open), while the prompt replayed from the in-memory pending-prompt cache is still `"pending"`. Both must collapse to a single Confirm card. Once the user answers, the `interactiveUi` flips to `"resolved"` / `"cancelled"` / `"dismissed"`, the helper stops hiding, and the chat shows the full tool card in history.

#### Scenario: Pending ask_user (live) shows only the interactive card
- **WHEN** an `ask_user` tool is mid-execution, a `toolResult` exists with `toolStatus: "running"`, and the next non-skip message is an `interactiveUi` with `status: "pending"`
- **THEN** the chat view SHALL render only the `InteractiveUiCard` (with Allow/Deny/Cancel buttons) and SHALL hide the running `toolResult`

#### Scenario: Pending ask_user (post-restart replay) shows only the interactive card
- **WHEN** the dashboard server has restarted while an `ask_user` was unanswered, the replayed `toolResult.toolStatus` is `"complete"`, `"error"`, or `"running"` (depending on whether the replay synthesized an orphan end), AND the next non-skip message is an `interactiveUi` with `status: "pending"` (replayed from the in-memory pending-prompt cache)
- **THEN** the chat view SHALL hide that `toolResult` and render only the `InteractiveUiCard`, so the user sees exactly one Confirm card per unanswered prompt

#### Scenario: Errored toolResult paired with pending interactiveUi is hidden
- **WHEN** a `toolResult` with `toolStatus: "error"` is followed (across skip roles) by an `interactiveUi` with `status: "pending"`
- **THEN** the chat view SHALL hide the errored `toolResult` (the pending UI takes precedence)

#### Scenario: Resolved tool history shows the full tool card
- **WHEN** the user has answered the `ask_user` prompt, the `interactiveUi.args.status` is `"resolved"`, and the corresponding `toolResult.toolStatus` is `"complete"`
- **THEN** the chat view SHALL render the full `ToolCallStep` (showing the question + `User responded:` result), and the `InteractiveUiCard` SHALL render its compact one-line resolved-state pill (e.g. `mdi-shield-alert ▸ Allowed`)

#### Scenario: Cancelled tool history shows the full tool card
- **WHEN** the `interactiveUi.args.status` is `"cancelled"` and the corresponding `toolResult.toolStatus` is `"complete"`
- **THEN** the chat view SHALL render the full `ToolCallStep` (no hide)

#### Scenario: Skip-roles do not break pairing
- **WHEN** a `toolResult` is followed by `thinking` and `assistant` messages and THEN a pending `interactiveUi`
- **THEN** the chat view SHALL still hide the `toolResult`

#### Scenario: Different intervening tool breaks pairing
- **WHEN** a `toolResult` for tool A is followed by a `toolResult` for tool B BEFORE any `interactiveUi`
- **THEN** the chat view SHALL render the tool-A card normally (no hide); the tool-B card may itself be hidden if it is followed by a pending `interactiveUi`

#### Scenario: Standalone tool with no interactive UI
- **WHEN** a `toolResult` has no subsequent `interactiveUi`
- **THEN** the chat view SHALL render the card normally regardless of `toolStatus`
