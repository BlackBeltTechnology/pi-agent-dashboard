## MODIFIED Requirements

### Requirement: Subagent live frames buffered across a connection gap

Subagent lifecycle frames (`subagent_created`/`subagent_started`/`subagent_completed`/`subagent_failed`) forwarded through the bridge's per-channel EventBus subscription that are emitted while the bridge is not ready to forward (`sessionReady` false, or between disconnect and re-register) SHALL be buffered rather than dropped, and SHALL be flushed to the server in emission order once the bridge re-registers. The buffer SHALL be bounded and SHALL prefer the latest frame per `agentId` when the bound is exceeded (each frame carries a full snapshot, so the latest supersedes older ones).

#### Scenario: Frame emitted while not ready is not lost

- **WHEN** the extension emits a `subagents:started` progress frame while the bridge's `sessionReady` is `false`
- **THEN** the frame SHALL be retained in the bridge's pending buffer
- **AND** SHALL be forwarded as an `event_forward` after the bridge next re-registers the session

#### Scenario: Latest snapshot wins under buffer pressure

- **WHEN** multiple progress frames for the same `agentId` are buffered and the buffer bound is exceeded
- **THEN** the bridge SHALL retain the most recent frame for that `agentId` and discard superseded older frames for it

#### Scenario: Ready bridge forwards immediately

- **WHEN** a subagent frame is emitted while `sessionReady` is `true` and the bridge `isActive()`
- **THEN** the frame SHALL be forwarded immediately with no buffering delay

