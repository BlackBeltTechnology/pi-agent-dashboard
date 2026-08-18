# on-demand-session-replay Specification

## Purpose

Loads session events on demand when a browser subscribes to a session whose events have been evicted from the in-memory buffer. The server reads session files directly from disk without requiring a bridge connection.

## Requirements

### Requirement: On-demand session loading via server
When a browser subscribes to a session whose events are not in memory, the server SHALL load the session directly from pi's session file on disk using `SessionManager.open(sessionFile).getBranch()`, without routing through a bridge.

#### Scenario: Browser subscribes to evicted session
- **WHEN** a browser subscribes to session "abc" whose events are not in memory, and the session has a `sessionFile` path
- **THEN** the server SHALL send an immediate `event_replay { events: [], isLast: false }` to the browser, load the session file directly via `SessionManager.open(sessionFile).getBranch()`, convert entries via `replayEntriesAsEvents()`, store in the event buffer, and send `event_replay { events, isLast: true }` to the browser

#### Scenario: Session file unavailable
- **WHEN** a browser subscribes to a session whose `sessionFile` does not exist, is corrupted, or is not set
- **THEN** the server SHALL send `event_replay { events: [], isLast: true }` and `session_updated { dataUnavailable: true }`

#### Scenario: Multiple browsers subscribe to same evicted session
- **WHEN** two browsers subscribe to the same evicted session before the load completes
- **THEN** the server SHALL deduplicate the load and deliver loaded events to both browsers

#### Scenario: Loaded events are buffered for future requests
- **WHEN** events are loaded on demand from disk
- **THEN** the server SHALL store them in the in-memory event buffer so subsequent browser subscribes do not trigger another load

### Requirement: Batch replay for on-demand loaded events
On-demand loaded events SHALL be delivered as batch `event_replay` messages, not as individual live `event` broadcasts. This prevents confusion between live streaming events and historical replay.

#### Scenario: Server receives loaded events
- **WHEN** the server loads events from a session file
- **THEN** it SHALL insert all events into the in-memory buffer, then send `event_replay { events, isLast: true }` to all waiting browsers

### Requirement: Client state reset on full replay
When the browser receives a full `event_replay` (first event has `seq === 1`), the client SHALL reset the session's `SessionState` to its initial state before reducing the replayed events. This prevents duplicate messages when switching between session cards or re-subscribing after a WebSocket reconnect. See the `event-reducer` spec for implementation details.

#### Scenario: Switching to a previously-subscribed session
- **WHEN** a user switches to a session card that was already loaded, triggering a new full replay
- **THEN** the client SHALL reset state and reduce from scratch, producing the same result as a fresh page load

#### Scenario: Live events not affected by loading
- **WHEN** live `event_forward` messages arrive for an active session while a different session is being loaded
- **THEN** the live events SHALL be broadcast normally to subscribers — loading only applies to the specific session being loaded

### Requirement: Stale lastSeq detection on subscribe
The subscription handler SHALL detect when a browser's `lastSeq` exceeds the server's max stored seq, and trigger a full reset-and-replay.

#### Scenario: Stale lastSeq triggers reset
- **WHEN** a browser subscribes with `lastSeq: 500` and the server has events up to seq `10` for that session
- **THEN** the server SHALL send `session_state_reset` to that browser WebSocket
- **AND** replay all events from seq 1

#### Scenario: Valid lastSeq returns delta
- **WHEN** a browser subscribes with `lastSeq: 50` and the server has events up to seq `100`
- **THEN** the server SHALL replay events with seq 51–100 without sending `session_state_reset`

### Requirement: Replay accepts a caller-supplied contextWindow override
The system SHALL allow callers of `replayEntriesAsEvents(sessionId, entries, knownContextWindow?)` to supply an optional `knownContextWindow` value. When provided, every synthesized `stats_update.contextUsage.contextWindow` field SHALL be set to that value; when omitted, the system SHALL fall back to `inferContextWindow(currentModel)`.

The server's on-demand replay path (`directoryService.loadSessionEvents`) SHALL forward `session.contextWindow` (loaded from `.meta.json`) as `knownContextWindow` so synthesized events surface the persisted value rather than the model-id heuristic.

Rationale: pi's `.jsonl` has no persisted `contextUsage`, so without the override every replayed `stats_update` for a Claude session reports `200_000` even when the live session ran on a 1M variant. This causes a visible flicker from `1M` → `200k` whenever a browser opens an ended session, until the next live `turn_end` arrives.

#### Scenario: Replay uses knownContextWindow when provided
- **GIVEN** an ended session with persisted `contextWindow: 1_000_000` in `.meta.json`
- **WHEN** the server's `loadSessionEvents` calls `replayEntriesAsEvents(sessionId, entries, 1_000_000)`
- **THEN** every emitted `stats_update.contextUsage.contextWindow` SHALL equal `1_000_000`

#### Scenario: Replay falls back to inference when override is undefined
- **GIVEN** a caller that does not supply `knownContextWindow`
- **WHEN** `replayEntriesAsEvents` synthesizes a `stats_update` for an assistant message with `usage.totalTokens > 0` after a `model_change` to `claude-sonnet-4-20250514`
- **THEN** the emitted `stats_update.contextUsage.contextWindow` SHALL equal `inferContextWindow("claude-sonnet-4-20250514")` (`200_000`)

#### Scenario: Server forwards persisted contextWindow through subscription replay
- **GIVEN** a browser subscribes to an ended session whose `Session.contextWindow` is `1_000_000`
- **WHEN** `subscription-handler` invokes `directoryService.loadSessionEvents(sessionId, sessionFile, session.contextWindow)`
- **THEN** every synthesized `stats_update` event delivered to the browser SHALL carry `contextUsage.contextWindow: 1_000_000`

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
