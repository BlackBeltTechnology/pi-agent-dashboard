## ADDED Requirements

### Requirement: Reconnect heal reports agent liveness symmetrically

On completing a reconnect handshake, the bridge SHALL report its authoritative agent-liveness truth (`getBridgeState().isAgentStreaming`) to the server in BOTH directions, not only when the agent is mid-turn.

- When the agent IS mid-turn, the bridge SHALL cause the server to hold `streaming` (today's synthetic `agent_start` satisfies this).
- When the agent is NOT mid-turn, the bridge SHALL send one immediate `session_heartbeat` carrying `agentRunning: false`. No new message type is introduced for this purpose. It SHALL NOT send a synthetic `agent_end`, because `agent_end` carries server-side run-boundary side effects (unread stamping, completed-first card reordering, attach-proposal clearing) that a correction must not fire.
- The heal SHALL be sent AFTER the connection has flushed frames buffered during the disconnect. Sending it earlier would let the correction overtake a buffered real `agent_end`, which would then observe a `streaming`→`idle` edge that no longer exists and would fail to stamp unread — a regression against current behaviour.

#### Scenario: Reconnect while mid-turn holds streaming

- **WHEN** the bridge completes a reconnect with `isAgentStreaming === true`
- **THEN** the server's status for the session is `streaming`

#### Scenario: Reconnect while idle clears a stale streaming

- **WHEN** the bridge completes a reconnect with `isAgentStreaming === false` and the server's status for the session is `streaming`
- **THEN** the bridge sends a `session_heartbeat` carrying `agentRunning: false`
- **AND** the server's status for the session becomes `idle`

#### Scenario: Buffered agent_end is processed before the heal

- **GIVEN** a real `agent_end` was buffered while the connection was down
- **WHEN** the connection reopens and the bridge performs the idle heal
- **THEN** the buffered `agent_end` reaches the server before the heal heartbeat
- **AND** the session is stamped unread exactly as it would have been without this change

#### Scenario: Idle reconnect sends no synthetic agent_end

- **WHEN** the bridge completes a reconnect with `isAgentStreaming === false`
- **THEN** no `agent_end` event is forwarded
- **AND** the session's unread state and name are unchanged by the reconnect

### Requirement: Heartbeat carries agent liveness

Each periodic `session_heartbeat` the bridge sends SHALL carry `agentRunning: boolean` reflecting `getBridgeState().isAgentStreaming` at send time. This heals a lost run-boundary event on a socket that never closes, which the reconnect path cannot reach.

The field SHALL be optional in the protocol so a bridge that predates this change still validates against a newer server; a heartbeat without the field SHALL be treated as carrying no liveness truth and SHALL trigger no reconcile.

#### Scenario: Heartbeat heals a stale streaming without a reconnect

- **GIVEN** the server's status for a session is `streaming` and the WebSocket has stayed open
- **WHEN** the bridge sends a heartbeat with `agentRunning: false`
- **THEN** the server's status for the session becomes `idle`

#### Scenario: Heartbeat during a real turn is inert

- **WHEN** the bridge sends a heartbeat with `agentRunning: true` while the server's status is `streaming`
- **THEN** the session's status, `currentTool`, and unread state are unchanged

#### Scenario: Heartbeat without the field changes nothing

- **WHEN** the server receives a heartbeat with no `agentRunning` field
- **THEN** no reconcile is performed and the session's status is unchanged
