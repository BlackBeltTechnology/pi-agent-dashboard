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
Each agent card SHALL display: agent name (or card label), status icon (pending ○, running spinner, complete ✓, error ✗, blocked ⚠), model role, recent tool calls (up to 3, newest first with tool name and input preview), and loop iteration badge when applicable.

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

### Requirement: Responsive grid layout
The card grid SHALL compute column count based on container width: `Math.min(cardCount, Math.max(1, Math.floor(width / minCardWidth)))` where `minCardWidth` is 200px. Cards SHALL have equal width within their row.

#### Scenario: Wide viewport shows multiple columns
- **WHEN** the container is 800px wide with 4 agent cards
- **THEN** the grid SHALL display 4 columns of 200px cards

#### Scenario: Narrow viewport stacks cards
- **WHEN** the container is less than 400px wide
- **THEN** the grid SHALL display 1 column with full-width cards

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
