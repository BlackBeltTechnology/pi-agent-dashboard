## ADDED Requirements

### Requirement: Server propagates attach/detach to the owning bridge

When `applyAttachProposal(sessionId, changeName, ctx)` mutates `session.attachedProposal`, the server SHALL also dispatch an `attach_proposal_changed { sessionId, attachedChange: <changeName | null> }` message through `pi-gateway` to the bridge currently owning that `sessionId`. This SHALL happen on every code path that funnels through `applyAttachProposal`, including:

- WebSocket `attach_proposal` handler in `session-meta-handler.ts`
- WebSocket `detach_proposal` handler in `session-meta-handler.ts`
- REST attach/detach endpoints (which already reuse `applyAttachProposal`)
- `pendingAttachRegistry.consume(cwd)` resolution at first `session_register`
- Any future caller of `applyAttachProposal` (single seam)

If no bridge is currently connected for `sessionId`, the dispatch SHALL be a silent no-op (state remains in `session.attachedProposal` and is replayed on next `session_register`).

#### Scenario: WS attach pushes message to bridge

- **WHEN** a browser sends `{ type: "attach_proposal", sessionId: "S1", changeName: "X" }`
- **AND** a bridge for `S1` is connected to `pi-gateway`
- **THEN** the server SHALL send `{ type: "attach_proposal_changed", sessionId: "S1", attachedChange: "X" }` to that bridge
- **AND** the existing `session_updated` browser broadcast SHALL still occur

#### Scenario: WS detach pushes null to bridge

- **WHEN** a browser sends `{ type: "detach_proposal", sessionId: "S1" }`
- **AND** a bridge for `S1` is connected
- **THEN** the server SHALL send `{ type: "attach_proposal_changed", sessionId: "S1", attachedChange: null }` to that bridge

#### Scenario: pendingAttachRegistry consume on spawn pushes to fresh bridge

- **WHEN** a bridge for cwd `C` first calls `session_register` and `pendingAttachRegistry.consume(C)` returns `"X"`
- **THEN** `applyAttachProposal(sessionId, "X", ctx)` runs
- **AND** the server SHALL send `{ type: "attach_proposal_changed", sessionId, attachedChange: "X" }` to that newly-registered bridge

#### Scenario: No connected bridge — dispatch is silent no-op

- **WHEN** a browser sends `{ type: "attach_proposal", sessionId: "S1", changeName: "X" }`
- **AND** no bridge for `S1` is currently connected
- **THEN** the server SHALL NOT throw and SHALL NOT log an error
- **AND** `session.attachedProposal === "X"` after the call

### Requirement: Server replays current attachedProposal on session_register

`pi-gateway.onSessionRegistered(sessionId, cwd)` SHALL, after the existing `pendingAttachRegistry.consume` step (and only when that step did NOT fire), look up the in-memory `DashboardSession` for `sessionId` and send `{ type: "attach_proposal_changed", sessionId, attachedChange }` to the bridge, where `attachedChange` is `session.attachedProposal` when it is a non-empty string, else `null`.

The explicit `null` replay is REQUIRED so a reattaching bridge with a stale persisted `attachedChange` is cleared: a detach that occurred while no bridge owned the session no-oped its push, so reattach is the only opportunity to clear it.

The replay SHALL run synchronously within the `onSessionRegistered` hook, before the bridge can submit its first user prompt for the registered session.

#### Scenario: Bridge reattach after dashboard restart receives current attached state

- **GIVEN** session `"S1"` had `attachedProposal === "X"` before dashboard restart
- **WHEN** the bridge reconnects and `session_register` fires for `S1`
- **AND** `pendingAttachRegistry.consume(cwd)` returns `null` (no pending intent)
- **THEN** the server SHALL send `{ type: "attach_proposal_changed", sessionId: "S1", attachedChange: "X" }` to the reattaching bridge

#### Scenario: Replay clears bridge state when session has no attached proposal

- **GIVEN** session `"S1"` has `attachedProposal === null`
- **WHEN** the bridge `session_register` fires
- **AND** `pendingAttachRegistry.consume(cwd)` returns `null`
- **THEN** the server SHALL send `{ type: "attach_proposal_changed", sessionId: "S1", attachedChange: null }` to clear any stale bridge-side attachment

#### Scenario: No replay for an unknown session

- **WHEN** `session_register` fires for a `sessionId` with no in-memory `DashboardSession`
- **THEN** the server SHALL NOT send any `attach_proposal_changed`

#### Scenario: Spawn-with-attach uses registry path, not replay path

- **GIVEN** the browser sent `spawn_session { cwd: "C", attachProposal: "X" }`, enqueueing into `pendingAttachRegistry`
- **WHEN** the new bridge's first `session_register` fires for `C`
- **THEN** `pendingAttachRegistry.consume("C")` returns `"X"` and triggers `applyAttachProposal` (which pushes `attach_proposal_changed`)
- **AND** the replay branch SHALL NOT fire (it is gated on the consume result), so exactly one `attach_proposal_changed` is sent for the register
