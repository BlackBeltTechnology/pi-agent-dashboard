## MODIFIED Requirements

### Requirement: Flow commands travel as plugin_action
The flows plugin server SHALL handle `plugin_action { pluginId: "flows", action }` for exactly six actions: `flow.abort`, `flow.toggle-autonomous`, `flow.dismiss-summary`, `flow.run`, `flow.delete` and `flow.set-edit-mode`, relaying fixed event names into the target session through `ctx.emitEventToSession`. An unknown action SHALL be logged and dropped. An invalid payload SHALL emit nothing. A session whose driver is `acp` SHALL be refused with `UNSUPPORTED_FOR_ACP` before any relay.

#### Scenario: Abort emits both abort events
- **WHEN** the server receives `flow.abort` for a session
- **THEN** it SHALL emit `flow:abort` and `flow:architect-abort` into that session

#### Scenario: Toggle autonomous
- **WHEN** the server receives `flow.toggle-autonomous`
- **THEN** it SHALL emit `flow:toggle-autonomous`

#### Scenario: Dismiss summary
- **WHEN** the server receives `flow.dismiss-summary` with `payload.runId` a string of 1 to 128 characters
- **THEN** it SHALL emit `flow:summary-dismissed { runId }`

#### Scenario: REST dismiss forwards runId
- **WHEN** `POST /api/plugins/flows/control` receives `{ sessionId, action: "flow.dismiss-summary", runId: "r1" }` from an operator
- **THEN** it SHALL emit `flow:summary-dismissed { runId: "r1" }`

#### Scenario: Dismiss summary without a valid runId
- **WHEN** the server receives `flow.dismiss-summary` with no `runId`, or a `runId` that is not a string of 1 to 128 characters
- **THEN** it SHALL emit `flow:summary-dismissed {}`

#### Scenario: Delete emits request and notify
- **WHEN** the server receives `flow.delete` with a valid `flowName`
- **THEN** it SHALL emit `flow:delete-request` and `flow:notify`

#### Scenario: Run keeps its existing relay
- **WHEN** the server receives `flow.run` with a valid `flowName` and `task`
- **THEN** it SHALL emit `flow:run { flowName, task }`

#### Scenario: Set edit-mode accepts a boolean only
- **WHEN** the server receives `flow.set-edit-mode` with `enabled: true` while the project's edit mode is off
- **THEN** it SHALL emit `flow:set-edit-mode { enabled: true }`; a request equal to the current mode SHALL emit nothing

#### Scenario: Non-boolean edit-mode ignored
- **WHEN** the server receives `flow.set-edit-mode` whose `enabled` is not a boolean
- **THEN** it SHALL emit nothing

#### Scenario: Invalid flowName rejected
- **WHEN** `flow.delete` or `flow.run` carries a `flowName` that is not a valid flow id
- **THEN** the server SHALL emit nothing and SHALL report the action as rejected

#### Scenario: Unknown action logged and dropped
- **WHEN** the server receives `plugin_action { pluginId: "flows", action: "flow.rename" }`
- **THEN** it SHALL log the unknown action
- **AND** it SHALL emit nothing into the session

#### Scenario: ACP session refused before relay
- **GIVEN** a session whose driver is `acp`

## ADDED Requirements

### Requirement: Flows bridge persists run dismissals
The flows plugin bridge SHALL listen to `flow:summary-dismissed` and, when its `runId` is a non-empty string, SHALL call `pi.appendEntry("flow-run-close", { seq, eventType: "flow_summary_dismissed", data: { runId } })`. It SHALL persist nothing when `runId` is absent, and SHALL never throw.

#### Scenario: Dismiss with runId is persisted
- **WHEN** pi emits `flow:summary-dismissed { runId: "r1" }` in a session with the flows bridge active
- **THEN** the bridge SHALL append one `flow-run-close` entry whose record is `{ eventType: "flow_summary_dismissed", data: { runId: "r1" } }` with a numeric `seq`

#### Scenario: Dismiss without runId is not persisted
- **WHEN** pi emits `flow:summary-dismissed {}`
- **THEN** the bridge SHALL NOT append any entry

#### Scenario: appendEntry failure is swallowed
- **WHEN** `pi.appendEntry` throws while persisting a dismissal
- **THEN** the bridge SHALL NOT throw and the live forward SHALL still occur

