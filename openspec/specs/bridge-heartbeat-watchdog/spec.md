# bridge-heartbeat-watchdog Specification

## Purpose

Lets the bridge notice that the dashboard server has gone away rather than holding a dead socket open indefinitely. Tracks the timestamp of the last message received and runs a liveness watchdog that fires when nothing has arrived within the expected window.

## Requirements

### Requirement: Track last message received timestamp
The `ConnectionManager` SHALL track the timestamp of the last message received from the server. This timestamp SHALL be updated on every incoming WebSocket message.

#### Scenario: Message received updates timestamp
- **WHEN** the bridge receives any WebSocket message from the server (including `heartbeat_ack`)
- **THEN** the `lastMessageAt` timestamp SHALL be updated to `Date.now()`

#### Scenario: New connection resets timestamp
- **WHEN** a WebSocket connection is established (onopen fires)
- **THEN** the `lastMessageAt` timestamp SHALL be set to `Date.now()`

### Requirement: Server liveness watchdog timer
The `ConnectionManager` SHALL run a watchdog timer that checks server liveness every 15 seconds. If no message has been received for 60 seconds, the connection SHALL be force-closed to trigger reconnection.

#### Scenario: Server is responsive
- **WHEN** the watchdog timer fires and `Date.now() - lastMessageAt < 60_000`
- **THEN** no action SHALL be taken and the connection SHALL remain open

#### Scenario: Server has gone silent
- **WHEN** the watchdog timer fires and `Date.now() - lastMessageAt >= 60_000`
- **THEN** the `ConnectionManager` SHALL close the WebSocket connection
- **AND** the reconnection logic SHALL be triggered (exponential backoff)

#### Scenario: Watchdog only runs while connected
- **WHEN** `disconnect()` is called on the `ConnectionManager`
- **THEN** the watchdog timer SHALL be cleared

#### Scenario: Watchdog starts on connect
- **WHEN** `connect()` is called on the `ConnectionManager`
- **THEN** the watchdog timer SHALL start with a 15-second interval
