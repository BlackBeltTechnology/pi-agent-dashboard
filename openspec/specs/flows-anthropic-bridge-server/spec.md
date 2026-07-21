# flows-anthropic-bridge-server Specification

## Purpose

The server-side plugin entry for the pi-flows Anthropic Messages Bridge. It exposes a diagnostic REST snapshot of per-PID bridge status, listens for bridge-emitted status and agent-active events from pi processes, records probe results into the shared plugin-status-store, and broadcasts status and agent-active updates to subscribed dashboard clients. The plugin degrades gracefully: the REST route is optional and event listeners remain the primary value.

## Requirements

### Requirement: Diagnostic status REST route

The plugin SHALL register a GET route at `/api/flows-anthropic-bridge/status` that returns the last-known status snapshot for every reporting bridge PID, guarded against registration after the HTTP server is already listening.

#### Scenario: Route returns per-PID snapshot

- **WHEN** a client requests GET `/api/flows-anthropic-bridge/status`
- **THEN** the response is `{ ok: true, pluginId: "flows-anthropic-bridge", sessions: [...] }`
- **AND** `sessions` contains the last-known `BridgeStatus` object for each PID that has reported

#### Scenario: No bridges have reported

- **WHEN** a client requests GET `/api/flows-anthropic-bridge/status` and no bridge status event has been received
- **THEN** the response is `{ ok: true, pluginId: "flows-anthropic-bridge", sessions: [] }`

#### Scenario: Fastify already listening at registration time

- **WHEN** the plugin loads and the underlying HTTP server reports `listening === true`
- **THEN** the plugin SHALL skip registering the `/api/flows-anthropic-bridge/status` route
- **AND** it SHALL log a warning that the route was skipped and bridge event listeners remain active

#### Scenario: Route registration throws

- **WHEN** registering the route raises an error despite the not-listening pre-flight
- **THEN** the plugin SHALL log a warning containing the error message
- **AND** it SHALL continue with the bridge event listeners active

### Requirement: Per-PID status aggregation

The plugin SHALL aggregate the latest bridge status keyed by process id, so that each PID's most recent report replaces any prior one.

#### Scenario: Status event updates the PID entry

- **WHEN** a `flows-anthropic-bridge:status` event arrives with a numeric `pid`
- **THEN** the plugin SHALL store the payload as the current status for that `pid`
- **AND** a subsequent report for the same `pid` SHALL overwrite the previous entry

#### Scenario: Status event missing a numeric pid

- **WHEN** a `flows-anthropic-bridge:status` event arrives whose `pid` is not a number
- **THEN** the plugin SHALL ignore the event and record no entry

### Requirement: Probe recording into plugin-status-store

The plugin SHALL record each received bridge status as a probe in the shared plugin-status-store under the id `flows-anthropic-bridge`, so `/api/health` can surface `lastProbe`, without ever throwing from the recording path.

#### Scenario: Probe recorded for a status event

- **WHEN** a valid `flows-anthropic-bridge:status` event is processed
- **THEN** the plugin SHALL call `recordBridgeProbe("flows-anthropic-bridge", { status, peers, at })` using the event's `status`, `peers` (defaulting to `{}` when absent), and `at`

#### Scenario: Probe recording fails

- **WHEN** recording the probe throws
- **THEN** the plugin SHALL swallow the error and continue processing the event

### Requirement: Broadcast bridge status to subscribers

The plugin SHALL broadcast each received bridge status to subscribed dashboard clients as a `flows_anthropic_bridge_status` message, without throwing from the broadcast path.

#### Scenario: Status broadcast to subscribers

- **WHEN** a valid `flows-anthropic-bridge:status` event is processed
- **THEN** the plugin SHALL broadcast `{ type: "flows_anthropic_bridge_status", pid, status }` to subscribers when a broadcast function is available

#### Scenario: Broadcast fails or is unavailable

- **WHEN** no broadcast function is exposed by the runtime, or the broadcast call throws
- **THEN** the plugin SHALL not throw and SHALL continue processing

### Requirement: Broadcast agent-active to subscribers

The plugin SHALL broadcast bridge agent-active events to subscribed dashboard clients as a `flows_anthropic_bridge_agent_active` message, without throwing.

#### Scenario: Agent-active broadcast

- **WHEN** a `flows-anthropic-bridge:agent-active` event arrives
- **THEN** the plugin SHALL broadcast `{ type: "flows_anthropic_bridge_agent_active", agent }` carrying the raw event payload to subscribers when a broadcast function is available
- **AND** it SHALL not throw if the broadcast is unavailable or fails

### Requirement: Optional event-listener wiring

The plugin SHALL wire its event listeners only when the runtime exposes an event emitter, staying forward-compatible with host versions that do not surface plugin custom events.

#### Scenario: Runtime exposes an event emitter

- **WHEN** the plugin context exposes `events.on` as a function
- **THEN** the plugin SHALL register listeners for `flows-anthropic-bridge:status` and `flows-anthropic-bridge:agent-active`

#### Scenario: Runtime does not expose an event emitter

- **WHEN** the plugin context does not expose an `events.on` function
- **THEN** the plugin SHALL register no listeners and still complete initialization, logging that the server entry is ready
