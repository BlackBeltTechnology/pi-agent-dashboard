# flow-browser-protocol Specification

## Purpose

Defines the flow control messages a browser sends to the dashboard server, so flow start/stop actions taken in the UI have a specified wire contract rather than an ad-hoc one.

## Requirements

### Requirement: Flow control messages from browser to server
The browser protocol SHALL define a `flow_control` message type for flow-specific actions sent from the browser to the server.

The message SHALL have the shape:
```
{ type: "flow_control", sessionId: string, action: "abort" | "toggle_autonomous" }
```

#### Scenario: Abort flow action
- **WHEN** the browser sends `{ type: "flow_control", sessionId, action: "abort" }`
- **THEN** the server SHALL forward an `abort` message to the bridge extension for that session

#### Scenario: Toggle autonomous mode action
- **WHEN** the browser sends `{ type: "flow_control", sessionId, action: "toggle_autonomous" }`
- **THEN** the server SHALL forward a `flow_control` message to the bridge extension, which SHALL call the pi-flows autonomous mode toggle API
