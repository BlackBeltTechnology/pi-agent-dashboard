## MODIFIED Requirements

### Requirement: Agent cards display live status
Each agent card SHALL display: agent name (or card label), status icon (pending ○, running spinner, complete ✓, error ✗, blocked ⚠), a stats line, one monospace basename line, the LAST 2 recent tool calls (newest first, with tool name and input preview), and a loop iteration badge when applicable.

The stats line SHALL remain the single carrier for the card's secondary values. A pending card with `blockedBy` SHALL render `waiting: <dependency names>` on that line; a complete card SHALL render tokens · cost · duration there (the cost segment suppressed exactly as `flow-agent-card` requires); when neither applies the line SHALL fall back to the resolved model, then to the role.

The basename line SHALL render one monospace line: the basename of the node's handler target for `code`/`code-decision` nodes, else the basename of the node's agent `.md` source path, else the node's `@alias` model string. The full path SHALL be exposed as that line's tooltip. The card SHALL NOT render a separate absolute-path line and SHALL NOT render a separate alias line.

The card body SHALL reserve exactly two lines and SHALL NOT create that reserved height with placeholder padding rows. Agent nodes SHALL render at most the LAST 2 tool calls, newest first (`▸` marking the newest, `·` the previous one) on that reserved body. A card with 0 or 1 entries SHALL keep the same reserved two-line height. The reservation SHALL use an explicit line box rather than a fixed pixel height implying a different text metric.

`code`/`code-decision` nodes SHALL render their log preview instead (`flow-card-status`). A code node with no program logs SHALL use the same reserved two-line body, so a code card and an agent card in one row are the same height. A code node WITH program logs SHALL render the shared `LogBlock` preview, whose own height (label, preview lines, copy and expand controls) defines the body height and grows the card past the reservation; the grid row track is `minmax(124px, auto)`, so the row grows as a unit and the cards in it stay equal in height.

#### Scenario: Card shows pending state with dependencies
- **WHEN** an agent step has `blockedBy` entries and has not started
- **THEN** the card SHALL show status "pending" with "waiting: <dependency names>"

#### Scenario: Card shows running state with tool calls
- **WHEN** a `flow_tool_call` event is received for an agent
- **THEN** the card SHALL update to show the tool name and a short input preview in the recent tools list

#### Scenario: Card shows complete state with tokens and duration
- **WHEN** a `flow_agent_complete` event is received for an agent
- **THEN** the card SHALL show ✓ status, token counts (↓input ↑output), and duration in seconds

#### Scenario: Card shows loop iteration badge
- **WHEN** a `flow_loop_iteration` event targets an agent card
- **THEN** the card SHALL display "↻ N/M" badge showing current iteration and maximum

#### Scenario: Card reserves two tool-call lines

- **WHEN** an agent card is rendered
- **THEN** its body SHALL reserve two lines of height whether it has 0, 1, or 2 tool calls
- **AND** the reserved height SHALL NOT be produced by placeholder padding rows

#### Scenario: A code card with logs grows its row instead of clipping the log

- **WHEN** a `code` card's log holds more lines than the two-line reservation
- **THEN** its body SHALL render the `LogBlock` preview (last 2 lines, copy full log, expand)
- **AND** the card MAY grow past the two-line reservation
- **AND** the grid row SHALL grow with it, keeping every card in that row equal in height

#### Scenario: Card shows the last two tool calls newest first

- **WHEN** an agent has recorded 3 or more tool calls
- **THEN** the card SHALL render the LAST 2 of them, newest first
- **AND** the newest SHALL be marked `▸` and the one before it `·`

#### Scenario: Card shows a basename with the full path as tooltip

- **WHEN** an agent node has a `.md` source path and a `code` node has a resolved handler target
- **THEN** each card SHALL render the basename of that path on its basename line
- **AND** the full path SHALL be exposed as that line's tooltip
- **AND** no absolute-path line SHALL be rendered on the card

#### Scenario: Card token arrows match the dashboard convention
- **WHEN** a complete agent card shows input and output token counts
- **THEN** input SHALL use `↓` and output SHALL use `↑`
