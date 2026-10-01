# flow-card-grid Specification

## Purpose
Client-side rendering of the in-session flow dashboard: sticky card grid showing per-agent status, controls, and responsive layout while a flow is active.

## Requirements

### Requirement: Flow dashboard component with responsive card grid
The React client SHALL render a `FlowDashboard` component at the top of the session content area when a flow is active. The component SHALL use `position: sticky; top: 0` to remain visible while the chat scrolls.

#### Scenario: Flow dashboard appears when flow starts
- **WHEN** the event reducer processes a `flow_started` event
- **THEN** the `FlowDashboard` component SHALL render above the `ChatView` showing agent cards

#### Scenario: Flow dashboard disappears after dismissal
- **WHEN** the flow is complete and the user dismisses the summary
- **THEN** the `FlowDashboard` component SHALL be removed from the layout

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
- **THEN** the card SHALL show ✓ status, token counts (↑input ↓output), and duration in seconds

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

### Requirement: Responsive grid layout
The card grid SHALL size its columns from a CSS auto-fill track of `minmax(190px, 1fr)`, so the number of columns follows the available container width instead of a hard-coded per-breakpoint count. Cards in the same row SHALL be equal in width AND equal in height: the grid row track SHALL be `minmax(124px, auto)`, and each card SHALL fill its row cell, so a row's cards share one height and each card's control row is bottom-aligned. The live grid and the frozen post-flow grid SHALL use the same column minimum, row track, and gap (8px), taken from one shared constant.

Below 480px of PANE width — measured with a container query on the grid wrapper, not the viewport — the grid SHALL collapse to a single column of compact tiles with a `minmax(76px, auto)` row track, hiding the basename line and the body lines, so a narrow split pane does not have to scroll a grid of full cards.

#### Scenario: Wide viewport shows multiple columns
- **WHEN** the container is 800px wide with 4 agent cards
- **THEN** the grid SHALL display 4 equal-width columns of at least 190px
- **AND** every card in the row SHALL be the same height

#### Scenario: Narrow viewport stacks cards
- **WHEN** the container is less than 400px wide
- **THEN** the grid SHALL display 1 column with full-width cards

#### Scenario: Cards in a row share one height

- **WHEN** two cards in the same row have different content lengths
- **THEN** both SHALL render at the row's height
- **AND** no card SHALL be shorter than its row
- **AND** each card's control row SHALL sit at the card's bottom edge

#### Scenario: Narrow pane collapses to compact tiles

- **WHEN** the grid wrapper is less than 480px wide (e.g. a narrow split pane on a desktop viewport)
- **THEN** the grid SHALL render a single column of compact tiles
- **AND** the basename line and the body lines SHALL NOT be rendered on those tiles

#### Scenario: Wide pane inside a narrow viewport keeps full cards

- **WHEN** the grid wrapper is at least 480px wide on a viewport below the mobile breakpoint
- **THEN** the grid SHALL render full cards
- **AND** the compact tile layout SHALL NOT be applied

### Requirement: Mobile collapsed mode
On mobile viewports, the flow dashboard SHALL collapse to a thin status bar showing the flow name and agent progress count. Tapping the bar SHALL expand to show the full card grid.

#### Scenario: Mobile shows collapsed bar
- **WHEN** the viewport is mobile-width and a flow is active
- **THEN** the flow dashboard SHALL render as a single-line bar (e.g., "π research-and-build · 2/4 agents") instead of the card grid

#### Scenario: Tap to expand on mobile
- **WHEN** the user taps the collapsed bar on mobile
- **THEN** the full card grid SHALL be displayed

#### Scenario: Desktop shows full grid
- **WHEN** the viewport is desktop-width
- **THEN** the flow dashboard SHALL always render the full card grid

### Requirement: Flow dashboard header
The flow dashboard SHALL include a header line showing the flow name and agent progress (e.g., "π research-and-build · 2/4 agents").

#### Scenario: Header updates as agents complete
- **WHEN** an agent completes
- **THEN** the header SHALL update the completed/total count

### Requirement: Card secondary text and file controls meet the contrast and target-size floors

Every secondary text line a flow agent card renders — the stats line's `waiting: <deps>` and token/cost/duration segment, the basename line, the tool-call lines, and the branch / failure annotations — SHALL meet WCAG 2.1 AA contrast for normal text (4.5:1) against the card's fill, by using the `--text-tertiary` token. The `--text-muted` token SHALL NOT carry card text. The primary (name) line keeps its current token.

Each file control in a card's bottom-right control row (the handler control and the agent-source control) SHALL present a hit target of at least 24×24 CSS px, per WCAG 2.2 SC 2.5.8. The icon glyph size and the control's visual weight SHALL be unchanged; only the clickable box grows.

#### Scenario: Secondary lines clear AA in both themes

- **WHEN** a card renders its stats line, basename line, or tool-call lines in the dark theme or in the light theme
- **THEN** each such line's text color SHALL measure at least 4.5:1 against the card's fill
- **AND** the card SHALL NOT use the `--text-muted` token for any of those lines

#### Scenario: File controls clear the 24×24 target size

- **WHEN** a card renders its handler control or its agent-source control
- **THEN** that control's clickable box SHALL measure at least 24×24 CSS px
- **AND** the rendered icon SHALL keep its current size
- **AND** the control SHALL keep its existing title text
