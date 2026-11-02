## MODIFIED Requirements

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
- **WHEN** a session cold-loads with replayed flow events and a replayed flow catalog event, and no live publish has happened since
- **THEN** the flow card (`FlowDashboardClaim`) SHALL reattach, and the flows plugin SHALL derive the session's flow catalog from the replayed catalog event, so the FLOWS dock chip and the flowless menu entry point reflect the catalog without waiting for the session (see `flows-catalog`)
