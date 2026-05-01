## ADDED Requirements

### Requirement: User-initiated resume tags an intent before spawn

Every code path that initiates a user-driven session resume (WebSocket `resume_session` handler, REST `POST /api/session/:id/resume`, drag-to-resume which already routes through the WS handler) SHALL invoke `pendingResumeIntentRegistry.record(sessionId)` immediately before invoking `spawnPiSession`. The tag SHALL persist for at most 60 seconds, after which it SHALL expire silently.

#### Scenario: WS resume tags intent
- **WHEN** the WebSocket `resume_session` handler receives a `mode: "continue"` message for an ended session
- **THEN** the registry SHALL contain the session id immediately before the `spawnPiSession` call
- **AND** the entry SHALL carry a creation timestamp ≤ 60 seconds in the past

#### Scenario: REST resume tags intent
- **WHEN** `POST /api/session/:id/resume` is called for an ended session
- **THEN** the registry SHALL contain the session id immediately before the spawn call

#### Scenario: Stale intent expires
- **WHEN** an intent has been in the registry for more than 60 seconds
- **THEN** `consume(sessionId)` SHALL return `false`
- **AND** the entry SHALL be removed

#### Scenario: Re-recording is idempotent
- **WHEN** `record(sessionId)` is called twice for the same id within the TTL window
- **THEN** the entry SHALL exist exactly once
- **AND** the timestamp SHALL be refreshed to the most recent call

### Requirement: Ended→alive sessionOrder mutation gated by user intent

The `sessionManager.onChange` ended→alive branch in `server.ts` SHALL consult `pendingResumeIntentRegistry.consume(sessionId)`. If `consume` returns `true` (user intent tagged), the branch SHALL apply the existing prepend-or-keep-dropped-slot logic and broadcast `sessions_reordered`. If `consume` returns `false` (no intent — typically bridge auto-reattach on dashboard reboot), the branch SHALL NOT mutate `sessionOrder` and SHALL NOT broadcast `sessions_reordered`. The `endedSessionIds` Set SHALL be updated regardless so transition tracking remains correct.

#### Scenario: User clicks Resume — id prepended, broadcast emitted
- **WHEN** the user clicks Resume on an ended session that is NOT currently in `sessionOrder` for its cwd
- **THEN** the registry SHALL be tagged with the session id
- **AND** when the bridge later sends `session_register`, the ended→alive branch SHALL prepend the id to `sessionOrder[cwd]`
- **AND** SHALL broadcast `sessions_reordered { cwd, sessionIds }` to all browsers

#### Scenario: Drag-to-resume — dropped slot preserved
- **WHEN** the user drags an ended card onto an alive card in the same folder, dispatching `reorder_sessions` (which writes the dropped position) followed by `resume_session`
- **THEN** when the bridge later sends `session_register`, the ended→alive branch SHALL find the id already in `sessionOrder[cwd]` at the dropped position
- **AND** SHALL NOT call `sessionOrderManager.insert` (the existing `if (!order.includes)` guard fires)
- **AND** SHALL still broadcast `sessions_reordered` so connected browsers refresh their local order map

#### Scenario: Bridge reattach on reboot — order untouched
- **WHEN** the dashboard server starts, the session scan restores a session as `status: "ended"`, and a still-running pi process bridge subsequently attaches and sends `session_register` (status flips ended→alive)
- **AND** no `pendingResumeIntentRegistry.record` was called for that session id
- **THEN** the ended→alive branch SHALL NOT call `sessionOrderManager.insert`
- **AND** SHALL NOT broadcast `sessions_reordered`
- **AND** the `endedSessionIds` Set SHALL still have the id removed (so a future alive→ended transition for the same session fires correctly)

#### Scenario: Multiple bridges reattach on reboot — none reorder
- **WHEN** five sessions are restored as ended on startup and all five pi processes reattach within the first 10 seconds
- **THEN** zero `sessions_reordered` broadcasts SHALL be emitted as a result of those reattaches
- **AND** the user's persisted `sessionOrder` for those cwds SHALL be unchanged across the restart

#### Scenario: Stale intent does not poison a later reboot
- **WHEN** the user clicks Resume but the spawn fails (bridge never attaches), 70 seconds pass, the dashboard restarts, and a later legitimate bridge reattach happens for the same session id
- **THEN** the stale intent SHALL have expired
- **AND** the bridge reattach SHALL be classified as a non-user transition (no reorder, no broadcast)

### Requirement: Alive→ended branch is unchanged

The alive→ended prune-and-broadcast behaviour added by `pin-and-search-sessions` SHALL remain identical. The intent registry has no role in alive→ended transitions; ended sessions are pruned from `sessionOrder` regardless of trigger because keeping ended ids in the alive-tier order is invariant violation.

#### Scenario: User-initiated session exit prunes order
- **WHEN** the user clicks the close button on an active session and its status flips alive→ended
- **THEN** the id SHALL be removed from `sessionOrder[cwd]`
- **AND** `sessions_reordered { cwd, sessionIds }` SHALL be broadcast

#### Scenario: Bridge-initiated session end prunes order
- **WHEN** an active pi process exits naturally (user quits the TUI) and the bridge sends a `session_unregister` causing alive→ended
- **THEN** the id SHALL be removed from `sessionOrder[cwd]`
- **AND** `sessions_reordered` SHALL be broadcast

### Requirement: Intent registry is in-memory only

The `pendingResumeIntentRegistry` SHALL hold its state in process memory only. It SHALL NOT persist to disk and SHALL NOT survive a server restart.

#### Scenario: Restart clears intents
- **WHEN** the server restarts
- **THEN** the new process's registry SHALL be empty regardless of what was tagged before the restart
