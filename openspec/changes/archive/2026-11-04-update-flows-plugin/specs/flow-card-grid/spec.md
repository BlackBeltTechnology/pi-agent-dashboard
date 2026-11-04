# Spec Delta

## MODIFIED Requirements

### Requirement: Flow dashboard component with responsive card grid
The React client SHALL render a `FlowDashboard` component at the top of the session content area when a flow is active. The component SHALL use `position: sticky; top: 0` to remain visible while the chat scrolls. When expanded, the panel SHALL be graph-first: it SHALL show the header and the flow graph (plus the question queue and YAML button), and SHALL place every agent card in an **Agent cards** section collapsed by default. The card grid geometry inside the section SHALL be unchanged.

The **Agent cards** section header SHALL be a disclosure button with `aria-expanded` and `aria-controls`, a hit target of at least 44 px below `sm` and at least 32 px from `sm`, and SHALL show the step count (a fan-out group counts as one) and state pills for done, running, failed and skipped.

#### Scenario: Flow dashboard appears when flow starts
- **WHEN** the event reducer processes a `flow_started` event
- **THEN** the `FlowDashboard` component SHALL render above the `ChatView`
- **AND** when expanded it SHALL show the graph and a collapsed **Agent cards** section

#### Scenario: Flow dashboard disappears after dismissal
- **WHEN** the flow is complete and the user dismisses the summary
- **THEN** the `FlowDashboard` component SHALL be removed from the layout

#### Scenario: Agent cards section header summarises state
- **GIVEN** a flow with 5 steps, one a fan-out group of 3 items, with 2 done, 1 running, 1 failed and 1 skipped
- **WHEN** the expanded panel renders with the section collapsed
- **THEN** the section header SHALL show 5 steps and pills for done 2, running 1, failed 1, skipped 1
- **AND** the disclosure button SHALL carry `aria-expanded="false"`

#### Scenario: Node click opens the section and reveals the card
- **WHEN** the user clicks the graph node for step `build` while the section is collapsed
- **THEN** the section SHALL open, `build` SHALL be selected, and its card (or fan-out group) SHALL scroll into view with `block: "nearest"`

#### Scenario: Reduced motion disables smooth scroll
- **GIVEN** the user prefers reduced motion
- **WHEN** a graph node click scrolls a card into view
- **THEN** the scroll SHALL NOT be smooth

#### Scenario: Clicking the selected node clears the selection
- **GIVEN** step `build` is selected and the section is open
- **WHEN** the user clicks the `build` node again
- **THEN** the selection SHALL clear and the section SHALL stay open
