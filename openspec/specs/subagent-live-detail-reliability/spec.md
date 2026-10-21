# subagent-live-detail-reliability Specification

## Purpose
TBD - created by archiving change fix-subagent-live-detail-reliability. Update Purpose after archive.

## Requirements

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

### Requirement: Running subagent timeline hydrated from the durable partialResult channel

The subagents plugin's `Agent` finalizer (`onToolExecution`, `dashboard-plugin-loader`) SHALL hydrate a running subagent's `session.subagents` entry from the durable `tool_execution_update` `partialResult`, not only from ephemeral `subagents:*` frames and the completion backfill, when an `Agent` row's `details` carry `agentId`. It SHALL reuse the backfill's detail mapping and dual index, SHALL NOT regress a really-terminal subagent, and SHALL add no bounded structure.

#### Scenario: Running partialResult hydrates the inspector map live

- **GIVEN** an Agent tool row and a `tool_execution_update` whose `partialResult.details` carry `agentId`, `status: "running"`, and a non-empty `entries[]`
- **WHEN** the reducer processes the update
- **THEN** `session.subagents.get(agentId)` SHALL be defined with `status: "running"` and the given `entries[]`
- **AND** when `details.agentSessionId` is present, `session.subagents.get(agentSessionId)` SHALL return the SAME `SubagentState` reference

#### Scenario: Late running partial does not regress a completed subagent

- **GIVEN** an Agent subagent whose `SubagentState` is already `completed` (via `tool_execution_end`)
- **WHEN** a late/reordered running `tool_execution_update` for the same `agentId` is processed
- **THEN** the `SubagentState` status SHALL remain `completed` (no regression to `running`)

#### Scenario: Non-Agent partialResult does not touch the subagents map

- **GIVEN** a non-Agent tool row and a structured `tool_execution_update` whose `details` carry no `agentId`
- **WHEN** the reducer processes the update
- **THEN** `session.subagents` SHALL be unchanged

#### Scenario: a session_ended-healed subagent is revived by a live tick
- **GIVEN** subagent `ag-1` is `failed` with the `session_ended` heal marker (from a synthesized end)
- **WHEN** a running `tool_execution_update` for its Agent row with `details.agentId:"ag-1"` reduces
- **THEN** `ag-1` status SHALL be `running` and the heal marker SHALL be cleared

#### Scenario: a really-terminal subagent is not revived
- **GIVEN** subagent `ag-1` is `completed` or `failed` through a real `subagent_completed`/`subagent_failed` or real Agent end
- **WHEN** a running `tool_execution_update` for it reduces
- **THEN** `ag-1` status SHALL remain terminal

#### Scenario: Inspector renders under frame loss

- **GIVEN** the ephemeral `subagents:*` frames of a running subagent were lost to bridge-not-ready buffering or WS back-pressure, and its durable `partialResult` updates arrived
- **WHEN** the user opens the subagent inspector during the run
- **THEN** it SHALL render the live timeline, or the running "No detail available yet." state once a map entry exists, and SHALL NOT show "Subagent not found in this session."

#### Scenario: Hydration is plugin code

- **GIVEN** the subagents plugin is disabled
- **WHEN** an `Agent` `tool_execution_update` carrying `details.agentId` reduces
- **THEN** `session.subagents` SHALL be unchanged, and core reducer code SHALL contain no writer of it

### Requirement: A subagent's own terminal event finalizes its Agent card

The client SHALL finalize a top-level `Agent` tool row as soon as it knows the row's subagent has stopped. The parent's `tool_execution_end` for the call need not arrive first. A row is eligible only while both the row and its tracked tool-call state are running. Rows that are elided, have no tracked state, or are already terminal SHALL NOT be changed.

Finalization SHALL happen in two cases:
1. When a `subagent_completed` or `subagent_failed` event is applied for the agent id the row's tool details carry.
2. When a progress update gives a running row an agent id whose subagent the client already knows has completed or failed.

Finalizing SHALL:
- set the row and its tracked tool-call state to complete on completion, or error on failure;
- set the row's subagent details status to `completed` or `error`;
- show the subagent's result, or its error text on failure. A non-empty fallback text SHALL be used when that is empty, so a stale progress line is never shown;
- compute any duration from the triggering event's timestamp;
- mark the row as healed. The marker SHALL be the triggering event's own heal marker when it carries one, else a subagent-stop marker.

A later real `tool_execution_end` for the call SHALL overwrite the healed row and clear the heal marker. A heal-marked subagent terminal event that the client ignores because the subagent is already terminal SHALL NOT finalize a row. Finalizing one row SHALL NOT change any other row.

#### Scenario: Dropped tool end, subagent completion still finalizes the card

- **GIVEN** three parallel `Agent` rows A, B, C are running, each row's tool details carrying its agent id
- **AND** the parent `tool_execution_end` for A never arrives
- **WHEN** `subagent_completed` for A's agent id is applied with result `"done A"`
- **THEN** A's row is complete and its card shows `"done A"` without a spinner
- **AND** B and C remain running

#### Scenario: Subagent failure finalizes as error with its message

- **GIVEN** a running `Agent` row for agent id X
- **WHEN** `subagent_failed` for X is applied with error `"boom"`
- **THEN** the row is in error and its card shows `"boom"`, not a spinner and not a stale progress line

#### Scenario: Completion with an empty result

- **GIVEN** a running `Agent` row for agent id X whose last progress text is `"X working"`
- **WHEN** `subagent_completed` for X is applied with no result
- **THEN** the row is complete and does not show `"X working"`

#### Scenario: Agent id learned after the subagent finished

- **GIVEN** `subagent_completed` for agent id X was applied while the running row for X had no agent id yet
- **WHEN** a progress update gives that row agent id X
- **THEN** the row is complete and shows X's result

#### Scenario: Normal ordering, real end follows the heal

- **GIVEN** a running `Agent` row for agent id X
- **WHEN** `subagent_completed` for X, then a trailing progress update with status `running`, then the real `tool_execution_end` for the call are applied
- **THEN** the row never shows running after the `subagent_completed`
- **AND** it ends with the real end's result and no heal marker

#### Scenario: Server session-end heal keeps its marker

- **GIVEN** a running `Agent` row for agent id X whose subagent is still running
- **WHEN** a `subagent_failed` for X carrying the session-ended heal marker is applied
- **THEN** the row is in error and carries the session-ended marker

#### Scenario: Terminal row is never touched

- **GIVEN** an `Agent` row already in error from its real end
- **WHEN** `subagent_completed` for its agent id is applied
- **THEN** the row stays in error with its original result

#### Scenario: No matching row is a no-op

- **WHEN** `subagent_completed` arrives for an agent id that no running `Agent` row carries
- **THEN** no tool row changes; the subagent state is updated as before

### Requirement: The parent run's settle finalizes any Agent card still running

When the client applies `agent_settled`, it SHALL finalize every eligible top-level `Agent` tool row (eligibility as above).

- **Subagent known to have finished:** if the row carries an agent id whose subagent the client knows has completed or failed, the row SHALL take that terminal status and that result or error, without a recovered indicator.
- **Otherwise:** the row SHALL become complete with a neutral body stating that the subagent stopped and its result was not received. It SHALL show a recovered indicator, SHALL NOT record the subagent as completed, and SHALL stay eligible for the existing authoritative tool-result recovery. A recovered result SHALL replace the neutral body and remove the recovered indicator.

Every row finalized here SHALL be marked as healed by the turn settle. The overwrite rule and the sibling rule of the subagent-stop finalization SHALL apply. `agent_end` alone SHALL NOT trigger this finalization.

#### Scenario: Both ends dropped, settle stops the spinner

- **GIVEN** an `Agent` row is running and neither its `tool_execution_end` nor its `subagent_completed` arrived
- **WHEN** `agent_settled` is applied
- **THEN** the row is no longer running
- **AND** its card shows the "stopped — result not received" body with the recovered indicator
- **AND** the subagent state for its agent id is not changed to completed

#### Scenario: Recovered result replaces the neutral body

- **GIVEN** an `Agent` row finalized by the settle with the "result not received" body
- **AND** the server holds the call's recorded result `"done C"`
- **WHEN** the existing stale tool-result recovery runs for the call
- **THEN** the card shows `"done C"` with no recovered indicator and no heal marker

#### Scenario: A tick after the settle does not reopen the card

- **GIVEN** an `Agent` row finalized by the settle
- **WHEN** a late progress update for the call arrives with status `running`
- **THEN** the card still shows the finalized state, without a spinner

#### Scenario: agent_end does not finalize

- **GIVEN** an `Agent` row is running
- **WHEN** `agent_end` is applied without `agent_settled`
- **THEN** the row is still running

#### Scenario: Non-Agent and elided rows are untouched by settle

- **GIVEN** a running `bash` row and an elided `Agent` row
- **WHEN** `agent_settled` is applied
- **THEN** neither row is changed by this requirement

### Requirement: A finished subagent's card is not reopened by a late progress tick

When a `tool_execution_update` targets an `Agent` row that is no longer running, and either the client knows that row's subagent has completed or failed or the row was finalized by the turn settle, the update SHALL NOT change the row's terminal status, heal marker, error, missing-result flag or shown result. Its other details SHALL apply as usual. Otherwise the update SHALL apply as before, which includes a replayed session-end orphan close of a still-running call.

A later real `tool_execution_end` SHALL also clear any missing-result flag and any heal-sourced error, together with the heal marker.

#### Scenario: Tick after a subagent-stop heal

- **GIVEN** an `Agent` row finalized by `subagent_completed`
- **WHEN** a late progress update for the call arrives with status `running`
- **THEN** the card still shows the completed state and result, without a spinner

#### Scenario: Tick after a real end of a finished subagent

- **GIVEN** an `Agent` row completed by its real `tool_execution_end`, and its subagent recorded as completed
- **WHEN** a late progress update for the call arrives with status `running`
- **THEN** the card still shows the completed state and the real result

#### Scenario: Real end clears heal-only flags

- **GIVEN** an `Agent` row finalized by the turn settle with the missing-result flag
- **WHEN** the real `tool_execution_end` for the call is applied
- **THEN** the row carries neither the missing-result flag nor the heal marker, and shows no recovered indicator

#### Scenario: Orphan-closed but still running

- **GIVEN** an `Agent` row closed by a replayed session-end orphan close, and its subagent not known to be finished
- **WHEN** a live progress update for the call arrives with status `running`
- **THEN** the card shows running again
