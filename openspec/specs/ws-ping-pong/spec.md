# ws-ping-pong Specification

## Purpose

Keeps WebSocket connections honest: a server-side ping interval, dead-connection detection via pong timeout, and interval cleanup when the server stops so a stopped server leaves no timer running.

## Requirements

### Requirement: Server-side WebSocket ping interval
The pi-gateway SHALL send a WebSocket-level ping frame to each connected bridge client every 30 seconds.

#### Scenario: Ping sent to connected client
- **WHEN** a bridge WebSocket connection has been open for 30 seconds since the last ping
- **THEN** the server SHALL send a WS-level `ping` frame on that connection

#### Scenario: Ping cycle repeats
- **WHEN** a pong response is received from the client
- **THEN** the server SHALL mark the connection as alive and continue the 30-second ping cycle

### Requirement: Dead connection detection via pong timeout
The pi-gateway SHALL terminate connections that fail to respond to a ping within 10 seconds. When a connection is terminated, the associated session SHALL be unregistered.

#### Scenario: Client responds to ping
- **WHEN** the server sends a ping and the client responds with pong within 10 seconds
- **THEN** the connection SHALL remain open and the `isAlive` flag SHALL be set to `true`

#### Scenario: Client fails to respond to ping
- **WHEN** the server sends a ping and no pong is received within 10 seconds (checked on the next ping cycle)
- **THEN** the server SHALL call `ws.terminate()` on the connection
- **AND** the associated session SHALL be unregistered with reason "ping timeout"

#### Scenario: Connection terminated triggers bridge reconnect
- **WHEN** the server terminates a dead connection
- **THEN** the bridge's `ConnectionManager` SHALL detect the close event and initiate reconnection with exponential backoff

### Requirement: Ping interval cleanup on server stop
The pi-gateway SHALL clear the ping interval timer when `stop()` is called.

#### Scenario: Server shutdown cleans up ping timer
- **WHEN** `piGateway.stop()` is called
- **THEN** the ping interval SHALL be cleared and no further pings SHALL be sent
