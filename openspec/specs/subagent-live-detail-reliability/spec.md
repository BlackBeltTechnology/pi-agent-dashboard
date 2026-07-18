# subagent-live-detail-reliability Specification

## Purpose
TBD - created by archiving change fix-subagent-live-detail-reliability. Update Purpose after archive.
## Requirements
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

The dashboard SHALL provide a path to recover the current timeline of a still-running subagent after a detected gap or reconnect, without waiting for the subagent to complete. On reconnect, OR on opening EITHER detail surface — the inline expand (Details toggle) or the popout dialog — for a running subagent whose `entries[]` is empty (including when the client's `subagents` map has no entry for that `agentId` at all, e.g. after a refresh/late-subscribe where the card's status is the authoritative running signal), the client SHALL request the latest known snapshot for that subagent, and the bridge SHALL respond with the most recent full `AgentDetails` snapshot it holds for that running subagent.

The id sent in the resync request MAY be either the `agentId` or the runner `agentSessionId`. The bridge SHALL resolve it against the SAME retained running-snapshot map it already maintains: first by `agentId` key, and on a miss by matching a retained snapshot whose `agentSessionId` equals the id. An id that matches no retained running snapshot SHALL remain a silent no-op.

The `agentSessionId`→snapshot resolution SHALL be DERIVED from the retained snapshot map, NOT maintained as a separate index. Consequently it introduces NO new bounded structure and NO independent lifecycle: it cannot outlive, leak past, or diverge from the snapshot map, and it inherits that map's existing 64-agent (logical, per-`agentId`) bound and eviction. A run whose retained snapshot has been removed (terminal frame or overflow) SHALL resolve to nothing by either id. The consume side MAY assume `agentSessionId` is stable per `agentId` for the life of a run (the producer mints the runner session id once at spawn).

#### Scenario: Resync after reconnect repopulates a running subagent

- **WHEN** the client reconnects while a subagent is still `running` and its client-side `entries[]` is empty
- **THEN** the client SHALL request a resync for that subagent
- **AND** the bridge SHALL reply with the latest retained `AgentDetails` snapshot so the timeline repopulates before completion

#### Scenario: Resync request carrying a runner session id resolves by derived match

- **GIVEN** a running subagent whose retained snapshot carries `agentSessionId`
- **WHEN** the client requests a resync with the runner session id in place of the `agentId`
- **THEN** the bridge SHALL match the retained snapshot by its `agentSessionId` and reply with it

#### Scenario: Terminated or evicted run resolves to nothing by either id

- **GIVEN** a subagent whose retained running snapshot has been removed (terminal frame `completed`/`failed`, or overflow eviction)
- **WHEN** a resync is requested with either its `agentId` or its `agentSessionId`
- **THEN** the bridge SHALL find no retained snapshot and SHALL send nothing (silent no-op) — no stale "running" snapshot is served, and no per-completed-subagent state accumulates

#### Scenario: Resolution adds no independent bound

- **WHEN** many subagents complete over a long session
- **THEN** the `agentSessionId` resolution SHALL NOT retain any state beyond the 64-agent running-snapshot map (it is derived from that map, not a separate index)

#### Scenario: Opening the inline expand resyncs a running subagent with an empty timeline

- **WHEN** the user opens the inline detail (the card's Details/expand toggle) for a subagent whose card status is `running` and whose client-side `entries[]` is empty or absent (no map entry)
- **THEN** the client SHALL request a resync for that subagent using the same path as the popout dialog
- **AND** the not-found placeholder ("Subagent not found in this session.") SHALL be replaced once the bridge replays the latest retained snapshot

#### Scenario: Opening detail for a subagent that already has entries does not resync

- **GIVEN** a running subagent whose client-side `entries[]` is non-empty
- **WHEN** the user opens either the inline expand or the popout dialog
- **THEN** the client SHALL NOT request a resync (the timeline is already populated)

#### Scenario: Resync for an unknown or finished agent is a no-op

- **WHEN** a resync is requested for an id the bridge no longer tracks as running (by either `agentId` or `agentSessionId`)
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

### Requirement: Subagent details may carry the runner session id

The `AgentDetails` payload of a subagent lifecycle frame (`subagent_created`/`subagent_started`/`subagent_completed`/`subagent_failed`) AND of the Agent tool's `tool_execution_end` result MAY carry an optional `agentSessionId` field — the id of the subagent's own runner session (distinct from the stable `agentId` and from the parent session id). Because the field rides `AgentDetails`, it reaches BOTH the live-frame reducer arm and the `tool_execution_end` backfill from a single producer edit. When the producer emits it, the consume side (bridge + reducer) SHALL treat it as an alias for the same subagent run. When it is absent (older producer), the consume side SHALL behave exactly as if only `agentId` were present — single-key, no alias, no regression.

#### Scenario: Frame with agentSessionId is dual-indexed

- **WHEN** a `subagent_started` frame arrives whose `details` carry both `agentId` and `agentSessionId`
- **THEN** the reduced `SubagentState` SHALL be retrievable from `session.subagents` under BOTH the `agentId` key and the `agentSessionId` key
- **AND** both keys SHALL reference the same `SubagentState` object
- **AND** the `SubagentState` SHALL persist `agentSessionId`

#### Scenario: Frame without agentSessionId keeps single-key behaviour

- **WHEN** a subagent frame arrives whose `details` carry no `agentSessionId`
- **THEN** the reduced `SubagentState` SHALL be retrievable only under the `agentId` key
- **AND** no alias key SHALL be added to `session.subagents`

### Requirement: Subagent inspector resolves a run by its runner session id

The subagent inspector (the card's inline expand, the popout dialog, and the `/session/:sessionId/subagent/:agentId` route) SHALL resolve a subagent's live timeline when the `:agentId` slot holds the runner session id, provided the run's frames carried `agentSessionId`. Because the reducer dual-indexes `session.subagents`, a `subagents.get(<runner session id>)` SHALL return the same `SubagentState` as `subagents.get(<agentId>)`, and the "Subagent not found in this session." placeholder SHALL NOT be shown for a runner session id that belongs to a tracked subagent of that parent session.

#### Scenario: Deep-link with a runner session id resolves the timeline

- **GIVEN** a subagent whose frames carried `agentSessionId` and whose reduced state is present under both keys
- **WHEN** the inspector is opened with the runner session id in the `:agentId` slot
- **THEN** the live timeline SHALL render (not the "Subagent not found" placeholder)

#### Scenario: Backfilled completed subagent is resolvable by either id

- **GIVEN** state-replay (on `/resume` or refresh) synthesizes no `subagents:*` frames and rehydrates completed subagents solely via the `tool_execution_end` (`toolName === "Agent"`) backfill
- **WHEN** the backfill's `endDetails` (an `AgentDetails`) carry `agentSessionId`
- **THEN** the backfilled `SubagentState` SHALL be indexed under both the `agentId` and the `agentSessionId` keys
- **AND** a deep link with that runner session id in the `:agentId` slot SHALL resolve the rehydrated timeline after refresh

#### Scenario: Unknown id still shows the placeholder

- **WHEN** the inspector is opened with an id that is neither a tracked `agentId` nor a tracked `agentSessionId` for that parent session
- **THEN** the "Subagent not found in this session." placeholder SHALL be shown (unchanged)

