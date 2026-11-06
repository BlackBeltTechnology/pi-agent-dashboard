# Spec Delta

## MODIFIED Requirements

### Requirement: Running-flow status pill lives in the FLOWS subcard

The FLOWS subcard SHALL render a status pill above the action button row whenever a session has an active flow (`flowState !== null` per the flows-plugin's session-state context). The pill SHALL include:

- The status icon — animated spinner when `flowState.status === "running"`,
  a check when `"success"`, a warning when `"error"`, a stop when
  `"aborted"`.
- The flow name (`flowState.flowName`).
- Agent counts (done / total) when status is `"running"`.
- An "Abort" button when status is `"running"`. Click sends
  `{ type: "plugin_action", pluginId: "flows", action: "flow.abort", sessionId }`
  via `usePluginSend`. The pill SHALL NOT send a `flow_control` message.

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
  `{ type: "plugin_action", pluginId: "flows", action: "flow.abort", sessionId }`
  via `usePluginSend`

#### Scenario: Pill omits Abort when flow is not running

- **GIVEN** the pill is rendering for a flow whose `status = "success"`,
  `"error"`, or `"aborted"`
- **THEN** the rendered pill SHALL NOT include an Abort button

#### Scenario: Pill is hidden when no flow active

- **GIVEN** a session whose `flowState` is `null` (no flow running or
  recently completed)
- **WHEN** the FLOWS subcard renders
- **THEN** the subcard SHALL NOT render the status pill
