## ADDED Requirements

### Requirement: Running-flow status pill lives in the FLOWS subcard

The FLOWS subcard SHALL render a status pill above the action button row whenever a session has an active flow (`flowState !== null` per the flows-plugin's session-state context). The pill SHALL include:

- The status icon — animated spinner when `flowState.status === "running"`,
  a check when `"success"`, a warning when `"error"`, a stop when
  `"aborted"`.
- The flow name (`flowState.flowName`).
- Agent counts (done / total) when status is `"running"`.
- An "Abort" button when status is `"running"`. Click sends
  `{ type: "flow_control", sessionId, action: "abort" }` via
  `usePluginSend`.

#### Scenario: Pill renders when flow is running

- **GIVEN** a session whose `flowState.flowName = "custom:test"` and
  `flowState.status = "running"` with 1 of 3 agents complete
- **WHEN** the user views the FLOWS subcard
- **THEN** the subcard SHALL render the pill showing
  "custom:test · 1/3 agents" with the animated spinner icon

#### Scenario: Pill includes Abort button when running

- **GIVEN** the pill is rendering for a flow whose `status = "running"`
- **WHEN** the user clicks the "Abort" button
- **THEN** the plugin SHALL dispatch
  `{ type: "flow_control", sessionId, action: "abort" }` via
  `usePluginSend`

#### Scenario: Pill omits Abort when flow is not running

- **GIVEN** the pill is rendering for a flow whose `status = "success"`,
  `"error"`, or `"aborted"`
- **THEN** the rendered pill SHALL NOT include an Abort button

#### Scenario: Pill is hidden when no flow active

- **GIVEN** a session whose `flowState` is `null` (no flow running or
  recently completed)
- **WHEN** the FLOWS subcard renders
- **THEN** the subcard SHALL NOT render the status pill

### Requirement: Flow activity badge no longer claims `session-card-badge`

The flows-plugin manifest SHALL NOT contain a
`session-card-badge` claim. The `FlowActivityBadge` renderer remains
available as a component, but it is consumed only by
`SessionFlowActions` (inside the FLOWS subcard) — not by the
`session-card-badge` slot.

#### Scenario: Manifest has no session-card-badge claim

- **WHEN** static analysis inspects
  `packages/flows-plugin/package.json#pi-dashboard-plugin.claims`
- **THEN** no claim SHALL have slot `"session-card-badge"`

#### Scenario: WORKSPACE subcard no longer shows flow activity

- **GIVEN** a session whose `flowState.flowName = "custom:test"` is
  running
- **WHEN** the user views the WORKSPACE subcard
- **THEN** the WORKSPACE subcard SHALL NOT render any flow activity
  badge for this session
- **AND** the FLOWS subcard SHALL render the status pill (per the
  Requirement above)
