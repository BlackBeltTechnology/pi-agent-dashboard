# flow-server-state Specification

## Purpose

Makes the dashboard server the holder of per-session flow metadata rather than each browser deriving it independently. The server tracks flow state per session and broadcasts flow events to subscribed browsers.

## Requirements

### Requirement: Server tracks per-session flow metadata
The server SHALL extract flow metadata from `flow_started` and `flow_complete` events and update the `DashboardSession` with flow-related fields: `activeFlowName`, `flowAgentsDone`, `flowAgentsTotal`, `flowStatus`.

#### Scenario: Flow started updates session
- **WHEN** a `flow_started` event is received for a session
- **THEN** the session SHALL be updated with `activeFlowName` set to the flow name, `flowAgentsTotal` set to the number of agent steps, `flowAgentsDone` set to 0, and `flowStatus` set to `"running"`

#### Scenario: Agent complete increments progress
- **WHEN** a `flow_agent_complete` event is received for a session
- **THEN** `flowAgentsDone` SHALL be incremented by 1

#### Scenario: Flow complete clears active flow
- **WHEN** a `flow_complete` event is received for a session
- **THEN** `flowStatus` SHALL be set to the result status (`"success"`, `"error"`, or `"aborted"`) and `activeFlowName` SHALL be preserved until the next `flow_started` or session ends

### Requirement: Server broadcasts flow events to subscribed browsers
The server SHALL forward all flow event types through the existing `EventMessage` broadcast pipeline to browser clients subscribed to the session.

#### Scenario: Flow events broadcast to subscribers
- **WHEN** a flow event is stored in the memory event store for a session
- **THEN** all browser clients subscribed to that session SHALL receive it as an `EventMessage`

#### Scenario: Flow events included in event replay
- **WHEN** a browser client subscribes to a session and requests replay from a sequence number
- **THEN** flow events stored in the memory event store SHALL be included in the `EventReplayMessage`
