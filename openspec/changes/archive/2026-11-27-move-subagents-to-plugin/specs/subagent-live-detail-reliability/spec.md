# Spec Delta

## MODIFIED Requirements

### Requirement: Subagent live frames buffered across a connection gap

Subagent lifecycle frames (`subagent_created`/`subagent_started`/`subagent_completed`/`subagent_failed`) that are emitted while the bridge is not ready to forward (`sessionReady` false, or between disconnect and re-register) SHALL be buffered rather than dropped, and SHALL be flushed to the server in emission order once the bridge re-registers. The buffering SHALL be the grouped `latest` retention of the subagents plugin's own lifecycle channel declarations, keyed by agent id, with no subagent-specific buffer in core. It SHALL be bounded, and SHALL keep the latest frame per agent across the lifecycle channels (each frame carries a full snapshot, so the latest supersedes older ones).

#### Scenario: Frame emitted while not ready is not lost

- **WHEN** the extension emits a `subagents:started` progress frame while the bridge's `sessionReady` is `false`
- **THEN** the frame SHALL be retained by the plugin channel's `latest` retention
- **AND** SHALL be forwarded as an `event_forward` after the bridge next re-registers the session

#### Scenario: Latest snapshot wins under buffer pressure

- **WHEN** multiple progress frames for the same agent are buffered
- **THEN** the bridge SHALL retain the most recent frame for that agent and discard superseded older ones

#### Scenario: Ready bridge forwards immediately

- **WHEN** a subagent frame is emitted while `sessionReady` is `true` and the bridge `isActive()`
- **THEN** the frame SHALL be forwarded immediately with no buffering delay

#### Scenario: Terminal frame supersedes buffered progress

- **WHEN** started and then completed are emitted for agent a1 while not ready
- **THEN** only the completed frame SHALL be flushed for a1

## REMOVED Requirements

### Requirement: Client can resync a running subagent's timeline
**Reason**: The resync snapshot is the latest `subagents:started` frame, which carries no `entries` since producer 0.3.0, so it cannot recover a timeline. Timeline recovery is provided by the stored `subagent_entry` stream and the windowed-replay carry. The `subagent_resync_request` message is removed from every protocol.
**Migration**: None for users. A client that still sends `subagent_resync_request` gets the server's unknown-message no-op. Inspector surfaces read the timeline from plugin state built from stored and carried entries.
