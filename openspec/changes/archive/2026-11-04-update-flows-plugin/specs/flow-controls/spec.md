# Spec Delta

## MODIFIED Requirements

### Requirement: Abort flow button
The flow dashboard header SHALL include an "Abort" button that dispatches `plugin_action { pluginId: "flows", action: "flow.abort" }` to stop the running flow.

#### Scenario: Abort running flow
- **WHEN** the user clicks the abort button while a flow is running
- **THEN** a `plugin_action` with `pluginId: "flows"` and `action: "flow.abort"` SHALL be sent to the server
- **AND** no `flow_control` message SHALL be sent

#### Scenario: Abort button hidden when no flow running
- **WHEN** no flow is active for the session
- **THEN** the abort button SHALL NOT be displayed

### Requirement: Autonomous mode toggle
The flow dashboard header SHALL include an "Auto" toggle button showing the current autonomous mode state. Clicking it SHALL dispatch `plugin_action { pluginId: "flows", action: "flow.toggle-autonomous" }`.

#### Scenario: Toggle autonomous mode on
- **WHEN** autonomous mode is off and the user clicks the Auto toggle
- **THEN** a `plugin_action` with `pluginId: "flows"` and `action: "flow.toggle-autonomous"` SHALL be sent and the toggle SHALL reflect the new state

#### Scenario: Autonomous mode state synchronized
- **WHEN** a `flow_started` event includes `autonomousMode: true`
- **THEN** the Auto toggle SHALL display as active
