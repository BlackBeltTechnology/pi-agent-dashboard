## ADDED Requirements

### Requirement: Liveness payload on the heartbeat does not affect the watchdog

The `session_heartbeat` message gains an advisory `agentRunning` field. The watchdog's liveness accounting SHALL remain purely message-arrival based: its 15-second check interval, its 60-second silence threshold, and its force-close-and-reconnect action SHALL NOT read, branch on, or be extended by `agentRunning`.

In particular, a long-running turn (`agentRunning: true`) SHALL NOT grant the server extra grace, and an idle session (`agentRunning: false`) SHALL NOT shorten the threshold.

#### Scenario: Silent server with a running agent still force-closes

- **WHEN** the watchdog fires, `Date.now() - lastMessageAt >= 60_000`, and the last heartbeat sent reported `agentRunning: true`
- **THEN** the connection SHALL be force-closed and reconnection triggered, exactly as when no agent was running

#### Scenario: Responsive server with an idle agent stays open

- **WHEN** the watchdog fires, `Date.now() - lastMessageAt < 60_000`, and the last heartbeat sent reported `agentRunning: false`
- **THEN** no action SHALL be taken and the connection SHALL remain open
