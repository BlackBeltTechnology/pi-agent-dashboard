## MODIFIED Requirements

### Requirement: Plugin manifest declares owned replay entry types
A plugin manifest SHALL be able to declare `pi-dashboard-plugin.replayEntryTypes: string[]`, naming the persisted `type: "custom"` entry `customType` values the plugin owns. The flows plugin SHALL declare `["flow-event", "flow-run-close"]`. Only enabled plugins SHALL contribute their declared types. The declared set SHALL come from manifests, so replay works for offline sessions with no live bridge.

#### Scenario: Flows plugin declares flow-event
- **WHEN** the dashboard server discovers plugin manifests with the flows plugin enabled
- **THEN** the declared replay entry type set SHALL contain `flow-event`

#### Scenario: Flows plugin declares flow-run-close
- **WHEN** the dashboard server discovers plugin manifests with the flows plugin enabled
- **THEN** the declared replay entry type set SHALL contain `flow-run-close`

#### Scenario: Disabled plugin contributes nothing
- **GIVEN** `plugins.flows.enabled = false`
- **WHEN** the declared replay entry type set is computed
- **THEN** it SHALL NOT contain `flow-event` or `flow-run-close`
