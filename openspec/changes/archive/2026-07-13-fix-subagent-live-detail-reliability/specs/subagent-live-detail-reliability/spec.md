## ADDED Requirements

### Requirement: Subagent live frames buffered across a connection gap

Subagent lifecycle frames (`subagent_created`/`subagent_started`/`subagent_completed`/`subagent_failed`) emitted by the bridge's `pi.events.emit` intercept while the bridge is not ready to forward (`sessionReady` false, or between disconnect and re-register) SHALL be buffered rather than dropped, and SHALL be flushed to the server in emission order once the bridge re-registers. The buffer SHALL be bounded and SHALL prefer the latest frame per `agentId` when the bound is exceeded (each frame carries a full snapshot, so the latest supersedes older ones).

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

### Requirement: Client can resync a running subagent's timeline

The dashboard SHALL provide a path to recover the current timeline of a still-running subagent after a detected gap or reconnect, without waiting for the subagent to complete. On reconnect (or on opening the detail surface for a running subagent whose `entries[]` is empty), the client SHALL request the latest known snapshot for that `agentId`, and the bridge SHALL respond with the most recent full `AgentDetails` snapshot it holds for that running subagent. The retained running-subagent snapshots SHALL be bounded to the same 64-agent limit as the pending buffer (latest-wins, drop-oldest), so resync storage cannot grow unbounded.

#### Scenario: Resync after reconnect repopulates a running subagent

- **WHEN** the client reconnects while a subagent is still `running` and its client-side `entries[]` is empty
- **THEN** the client SHALL request a resync for that `agentId`
- **AND** the bridge SHALL reply with the latest retained `AgentDetails` snapshot so the timeline repopulates before completion

#### Scenario: Resync for an unknown or finished agent is a no-op

- **WHEN** a resync is requested for an `agentId` the bridge no longer tracks as running
- **THEN** the bridge SHALL NOT error and SHALL send no snapshot (the durable completed-case backfill already covers finished subagents)

### Requirement: Populated timeline is never clobbered by an empty frame

The event reducer SHALL NOT overwrite an already-populated subagent `entries[]` with an incoming empty array. An incoming frame whose `details.entries` is `[]` SHALL preserve the existing non-empty `entries[]` for that `agentId`; a frame with a non-empty `entries[]` SHALL replace wholesale as before.

#### Scenario: Empty-array frame preserves existing entries

- **GIVEN** a subagent whose reduced state already has `entries` of length 3
- **WHEN** a `subagent_started` frame arrives with `details.entries` equal to `[]`
- **THEN** the reduced state SHALL still have the 3 existing entries

#### Scenario: Non-empty frame replaces entries

- **GIVEN** a subagent whose reduced state has `entries` of length 3
- **WHEN** a frame arrives with `details.entries` of length 5
- **THEN** the reduced state SHALL have the 5 new entries
