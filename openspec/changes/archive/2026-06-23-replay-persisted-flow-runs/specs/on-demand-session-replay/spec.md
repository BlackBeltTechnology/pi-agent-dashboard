## ADDED Requirements

### Requirement: Replay reconstructs persisted flow runs

`replayEntriesAsEvents` SHALL synthesize `event_forward` messages from persisted flow-run entries so a flow card rebuilds after `/resume`, browser refresh, or dashboard server restart.

For each session entry where `entry.type === "custom"` AND `entry.customType === "flow-event"`, replay SHALL read the record shape `{ seq: number, eventType: string, data: unknown, flowRunId: string }` and emit one `event_forward` message carrying that record's `eventType` and `data` verbatim. The `eventType` is already the dashboard protocol name (e.g. `flow_tool_call`), so replay SHALL NOT re-map it.

Replay SHALL order the emitted flow-event messages by ascending `seq`. The record type is duck-typed; replay SHALL NOT import any type from pi-flows.

Malformed flow-event records (missing or non-string `eventType`) SHALL be skipped without throwing.

#### Scenario: Persisted flow events replayed in seq order
- **WHEN** a session JSONL contains `flow-event` custom entries with `seq` 0,1,2 mapping to `flow_started`, `flow_agent_started`, `flow_tool_call`
- **THEN** `replayEntriesAsEvents` SHALL emit three `event_forward` messages with those `eventType` values, in `seq` order, each carrying the record's `data`

#### Scenario: Custom non-flow entries ignored
- **WHEN** a session JSONL contains a `type:"custom"` entry whose `customType` is not `"flow-event"`
- **THEN** replay SHALL NOT emit an `event_forward` for it

#### Scenario: Malformed flow-event record skipped
- **WHEN** a `flow-event` custom entry has a missing or non-string `eventType`
- **THEN** replay SHALL skip the entry and continue without throwing

#### Scenario: Existing message and model_change replay unaffected
- **WHEN** a session JSONL contains `message` and `model_change` entries alongside `flow-event` entries
- **THEN** replay SHALL still synthesize the message and model_change events exactly as before, in addition to the flow-event messages

### Requirement: Replayed events reach the plugin-runtime event store

Server-side replay is necessary but not sufficient for the flow card to reappear: the dashboard client SHALL deliver replayed session events into the plugin-runtime per-session event store (`publishSessionEvent` / plural `publishSessionEvents`) so plugin slot consumers reading `useSessionEvents(sessionId)` rehydrate on cold load (`/resume`, browser refresh, server restart), matching the live `event` path.

Rationale: the flow card claim (`FlowDashboardClaim`, slot `content-header-sticky`) declares no `shouldRender` gate; it self-gates on `flowState !== null`, derived solely from `useSessionEvents` via `reduceFlowsSessionState`. The shell reducer's `sessionStates` is NOT read by flows-plugin. Subagent cards survive replay only because their state lives in the shell reducer (`SessionState.subagents`), which the `event_replay` loop already feeds; plugin-owned state needs the same delivery into the plugin store. Before this requirement, the client `event_replay` handler folded the batch into `sessionStates` but never called `publishSessionEvent`, so `useSessionEvents` stayed empty on cold load and the slot never reattached.

The client SHALL reuse the same `shouldReset` condition the shell reducer applies: on a full-replay sweep it SHALL clear the plugin store for the session before republishing (so re-replay does not duplicate events); on a continuation batch it SHALL append without clearing.

The per-append cost is bounded by the shell's existing `event_replay` reduce loop (which already rebuilds `sessionStates` over the same N events on every cold load); the plural `publishSessionEvents` keeps the plugin-store delivery to one array spread and one subscriber notification.

This applies to every plugin reading `useSessionEvents` (flows, goal-plugin), not only flows.

#### Scenario: Replayed flow events rebuild plugin flow state on cold load
- **WHEN** an `event_replay` batch containing `flow_started` and `flow_tool_call` is processed by the client
- **THEN** `getSessionEvents(sessionId)` SHALL contain those events AND `reduceFlowsSessionState(getSessionEvents(sessionId))` SHALL yield a non-null `flowState`

#### Scenario: Re-replay does not duplicate plugin events
- **WHEN** a full-replay sweep (`shouldReset` true) is processed after the plugin store already holds events for the session
- **THEN** the client SHALL clear the store before republishing so each event appears exactly once

#### Scenario: Continuation batch appends without clearing
- **WHEN** a paginated continuation `event_replay` batch (`shouldReset` false) is processed
- **THEN** the client SHALL append the batch to the existing plugin store without clearing

#### Scenario: Actions subcard availability is a separate non-replayed signal
- **WHEN** a session cold-loads with replayed flow events but no live `flows_list`/`commands_list` has been re-published
- **THEN** the flow card (`FlowDashboardClaim`) SHALL reattach (it has no availability gate), while the actions subcard (`SessionFlowActionsClaim`, gated by `shouldRenderFlowsSubcard` → `getFlowsAvailabilitySync`) MAY remain hidden until availability is rehydrated; rehydrating availability from replayed flow events or re-publishing the flows list on subscribe is tracked as follow-up

### Requirement: Durable replay depends on upstream flush of custom entries (KNOWN BLOCKER)

This replay requirement is **necessary but not sufficient** for reload survival: it SHALL only reconstruct what reached the session JSONL on disk. Persisted `flow-event` entries reach disk only when pi-core flushes them, and the system SHALL NOT assume that flow-first sessions are durable until the upstream flush (below) lands.

pi-core `SessionManager._persist` gates the session-file flush on the FIRST assistant message: it buffers ALL entries (including `type:"custom"` `flow-event` records) in memory and does not create the `.jsonl` until an `role:"assistant"` message is appended. Therefore a **flow-first session** (flow run as the first action, no assistant message yet) has NO file on disk, and this replay finds nothing — the flow card AND graph (both projections of the same event stream) fail to rebuild on dashboard server restart, cold load, or `/resume`.

Proven by controlled experiment: 3 `appendCustomEntry("flow-event", …)` calls produce no file; the file appears with all 3 entries only after the first `appendMessage({role:"assistant"})`. Confirmed on real data: session `019eeecc` buffered 184 `flow-event` entries (first at line 5) and flushed them all at the first assistant message (line 190); replaying that real file through the shipped branch reconstructs the full `flow_*` stream.

No manual or programmatic trigger reachable from pi-flows or the dashboard can open the gate: `ctx.sessionManager` is `ReadonlySessionManager` (no append/flush), `appendEntry` writes `type:"custom"` (never opens the gate), `sendMessage` writes `custom_message`, `sendUserMessage` writes a `user` message. The flush gate inspects only `type:"message" && role:"assistant"` and ignores content, so an empty or sentinel assistant message would open it — but `buildSessionContext` forwards every `message` entry to the provider verbatim with no empty-content filter, so that approach risks provider rejection and SHALL NOT be used.

Resolution is OUTSIDE this capability and OUTSIDE this repo — it requires an upstream change in `@earendil-works/pi-coding-agent`. Preferred: flush on an opt-in `type:"custom"` flush-marker entry (writable from pi-flows via `appendEntry`, excluded from LLM context by `buildSessionContext`, preserves the gate's no-empty-files purpose, works mid-flow). Acceptable alternatives: flush all custom entries immediately, or expose a `flush()` API. The ExtensionAPI currently exposes no flush surface, so neither pi-flows nor the dashboard can close this gap. A dashboard-side alternative (persist forwarded events to the dashboard's own per-session store and replay from it on cold load) is possible but heavier and duplicative; it is explicitly deferred.

Until the upstream flush lands, the live multi-client path (server in-memory event buffer replayed on subscribe) still rebuilds the card for clients attaching while the server is up; only durable reload across a server restart / cold / resume is blocked.

#### Scenario: Flow-first session has no file to replay
- **WHEN** a flow runs as the first action in a session and no assistant message has been appended
- **THEN** pi-core has not created the session `.jsonl`, so `replayEntriesAsEvents` has no entries to read and the flow card cannot be rebuilt on cold load

#### Scenario: Buffered flow events flush on first assistant message
- **WHEN** the parent session appends its first `role:"assistant"` message after a flow ran
- **THEN** pi-core flushes all buffered entries (including every `flow-event` record and `flow_started`/graph data) to the `.jsonl`, and subsequent replay reconstructs the full card and graph

#### Scenario: Empty assistant message rejected as a flush workaround
- **WHEN** considering whether to append an empty or sentinel-character `role:"assistant"` message to force the flush
- **THEN** the system SHALL NOT do so, because `buildSessionContext` forwards that message to the provider verbatim (no empty-content filter), risking provider rejection of an empty turn and alternation errors on the next real turn

#### Scenario: Custom flush-marker is the preferred upstream resolution
- **WHEN** the upstream flush fix is implemented in `@earendil-works/pi-coding-agent`
- **THEN** it SHOULD flush on an opt-in `type:"custom"` flush-marker entry (writable from pi-flows via `appendEntry`, excluded from LLM context by `buildSessionContext`), rather than by injecting any `message` entry
