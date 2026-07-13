## ADDED Requirements

### Requirement: Live event bursts coalesce into per-frame state application

Live forwarded session events (`event` messages) arriving over the WebSocket SHALL be queued and applied in a single state update per animation frame (or equivalent flush when the tab is hidden), so that a burst of N events produces at most one `setSessionStates` application and one React render pass instead of N.

#### Scenario: Burst produces one render
- **WHEN** multiple `event` messages for the same session arrive within one frame interval
- **THEN** the client SHALL apply them in one state update (folding each event through the reducer) and the chat view SHALL re-render at most once for that frame

#### Scenario: Coalescing preserves event order and final state
- **WHEN** a queued batch of events is flushed
- **THEN** events SHALL be folded in ascending sequence order and the resulting `SessionState` SHALL be byte-identical to applying the same events one-by-one

#### Scenario: Per-event side effects still fire
- **WHEN** an event inside a coalesced batch carries a side effect (e.g. an interactive `ask_user` request, seq-tracking update, plugin event mirror)
- **THEN** that side effect SHALL still be triggered exactly as it would have been under per-event application

#### Scenario: Hidden tab still applies events
- **WHEN** events arrive while the tab is backgrounded (animation frames throttled or suspended)
- **THEN** the queue SHALL still flush via a non-rAF fallback so session state stays current and no event is delayed indefinitely

#### Scenario: Replay path unchanged
- **WHEN** history is delivered via the replay path (`event_replay` batches)
- **THEN** the existing replay batching behavior SHALL remain unchanged by live-event coalescing
