# flow-server-state Specification

## Purpose

Makes the dashboard server the holder of per-session flow metadata rather than each browser deriving it independently. The server tracks flow state per session and broadcasts flow events to subscribed browsers.

## Requirements

### Requirement: Server broadcasts flow events to subscribed browsers
The server SHALL forward all flow event types through the existing `EventMessage` broadcast pipeline to browser clients subscribed to the session.

#### Scenario: Flow events broadcast to subscribers
- **WHEN** a flow event is stored in the memory event store for a session
- **THEN** all browser clients subscribed to that session SHALL receive it as an `EventMessage`

#### Scenario: Flow events included in event replay
- **WHEN** a browser client subscribes to a session and requests replay from a sequence number
- **THEN** flow events stored in the memory event store SHALL be included in the `EventReplayMessage`
