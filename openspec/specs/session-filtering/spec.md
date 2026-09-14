## Purpose
Describes how the dashboard sidebar filters which sessions are visible: hide-flag handling, the per-folder archive fold, the visibility toggle in the sidebar header, and the per-folder collapsible ended-sessions group. Drag-reorder restrictions and drag-to-resume rules also live here since they govern session visibility/ordering.

## Requirements

### Requirement: Show hidden toggle

The sidebar SHALL include a `Show hidden` toggle as the only filter chip in the header. Hidden sessions are auto-hidden headless workers only; there is no manual hide. When enabled, hidden sessions SHALL reappear in the list with a muted visual style (reduced opacity). Hidden sessions SHALL also show resume/fork buttons. No unhide button SHALL be rendered.

The previous companion `Active only` toggle SHALL be removed; ended sessions are now visible by default inside their folder's collapsible ended-sessions group rather than hidden behind a toggle.

#### Scenario: Show hidden is the only filter chip in the header
- **WHEN** the sidebar header renders
- **THEN** the filter row SHALL contain a `Show hidden` toggle and SHALL NOT contain an `Active only` toggle

#### Scenario: Reveal hidden sessions
- **WHEN** the user enables `Show hidden`
- **THEN** all hidden sessions SHALL appear in the list with reduced opacity and resume/fork action buttons
- **AND** no unhide button SHALL be present

#### Scenario: Unhide a session
- **WHEN** a hidden session is revealed via `Show hidden`
- **THEN** no unhide `[↩]` button SHALL be rendered and no browser message SHALL be able to clear `hidden`; the only way out of the hidden set is the session ending and being archived

### Requirement: Hidden count indicator
When hidden sessions exist and "Show hidden" is OFF, the session list SHALL display an "N hidden workers" indicator at the bottom of the list. N SHALL count only sessions with `hidden = true`; archived sessions SHALL NOT be counted.

#### Scenario: Hidden sessions exist
- **WHEN** one or more sessions are hidden and "Show hidden" is OFF
- **THEN** the list SHALL show "N hidden workers" at the bottom where N is the count

#### Scenario: No hidden sessions
- **WHEN** no sessions are hidden
- **THEN** the hidden count indicator SHALL NOT be displayed

#### Scenario: Archived sessions are not hidden
- **WHEN** 300 sessions are archived and 0 are hidden
- **THEN** the hidden count indicator SHALL NOT be displayed

### Requirement: Filter interaction

The `Show hidden` toggle, server-side hidden flag, per-folder collapsible ended group and per-folder archive fold SHALL work together. The server-side `hidden` flag is the source of truth for `hidden` visibility; the per-folder collapsible group governs `ended` visibility; the archive fold governs `archived` visibility. `Show hidden` SHALL NOT reveal archived sessions.

#### Scenario: Hidden alive session with Show hidden OFF
- **WHEN** an alive session has `hidden = true` and `Show hidden` is OFF
- **THEN** the session SHALL NOT be visible

#### Scenario: Ended session with Show hidden ON
- **WHEN** an ended session has `hidden = true` and `Show hidden` is ON
- **THEN** the session SHALL be visible with muted styling and resume/fork buttons inside its folder's ended group

#### Scenario: Show hidden does not reveal archived
- **WHEN** `Show hidden` is ON and a folder has archived sessions
- **THEN** archived sessions SHALL remain only inside the folder's archive fold

### Requirement: Server-side hidden state
Hidden state SHALL be managed server-side via the in-memory session manager with persistence through the session sidecar. `hidden` SHALL be set only by the auto-hide heuristic or an explicit bridge visibility intent; no browser message SHALL set or clear it. The client-side localStorage hidden set is no longer used. The server SHALL be the source of truth for visibility.

#### Scenario: Migration from client-side hidden
- **WHEN** the client detects a legacy `hiddenSessions` key in localStorage
- **THEN** it SHALL ignore it (server-side hidden flag takes precedence) and remove the key

#### Scenario: No browser verb mutates hidden
- **WHEN** a browser sends a legacy `hide_session` or `unhide_session` message
- **THEN** the server SHALL reject it as an unknown message and SHALL NOT change any session

### Requirement: Per-folder ended-sessions collapsible group

Inside each folder, ended sessions SHALL be rendered in a collapsible group below the alive sessions. The group SHALL be collapsed by default with a `N ended` toggle row at the bottom of the folder. When expanded, a second `Hide ended` toggle SHALL appear immediately above the first ended card AND the original `Hide ended` toggle SHALL remain at the bottom — both clickable to collapse.

#### Scenario: Default folder shows alive sessions and collapsed ended row
- **WHEN** a folder contains both alive and ended sessions
- **THEN** alive sessions SHALL render directly
- **AND** a `N ended` toggle row SHALL render at the bottom of the folder

#### Scenario: Expand ended group
- **WHEN** the user clicks the `N ended` toggle row
- **THEN** the ended sessions SHALL render between the alive sessions and the bottom toggle
- **AND** a second `Hide ended` toggle SHALL appear at the top of the ended group
- **AND** the bottom `Hide ended` toggle SHALL also remain visible

#### Scenario: Either toggle collapses the group
- **WHEN** the user clicks either the top or the bottom `Hide ended` toggle
- **THEN** the ended sessions SHALL collapse back into the `N ended` row

#### Scenario: Active filter auto-expands ended
- **WHEN** either the `Folder…` filter or the `Session…` search has a non-empty value
- **THEN** every visible folder's ended group SHALL be auto-expanded
- **AND** the bottom toggle SHALL be hidden during filtered view

### Requirement: Drag-reorder applies only to alive sessions

The persisted drag-reorder list (`sessionOrder`) SHALL contain alive session ids only. When a session transitions from alive to ended, the server SHALL prune its id from `sessionOrder` for that cwd and broadcast `sessions_reordered` with the new order. Subsequent `update()` calls on an already-ended session SHALL NOT re-trigger the prune.

#### Scenario: Active session can be drag-reordered
- **WHEN** the user drags an alive session onto another alive session
- **THEN** `reorder_sessions` SHALL persist the new order
- **AND** the order SHALL survive across server restarts

#### Scenario: Ending a session prunes its order entry once
- **WHEN** a session transitions from alive to `status = "ended"`
- **THEN** the server SHALL remove its id from `sessionOrder` for that cwd
- **AND** SHALL broadcast `sessions_reordered` with the new order
- **AND** subsequent updates on the ended session SHALL NOT re-emit the broadcast

#### Scenario: Drag-to-resume preserves dropped position
- **WHEN** the user drags an ended session onto an alive session in the same folder
- **THEN** `reorder_sessions` SHALL persist the new order with the ended id at the drop position
- **AND** `resume_session` SHALL fire for that id in `continue` mode
- **AND** when the resume completes the card SHALL remain at the dropped position

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

### Requirement: Auto-hide headless non-dashboard sessions at first registration

On the **first** registration of a session, the server SHALL set `hidden = true` when `hasUI === false` AND `source !== "dashboard"`, unless overridden by an explicit visibility intent. This hides throwaway headless workers (e.g. `pi --model M -p "…"` subprocesses) by default while leaving genuine TUI sessions and dashboard-spawned headless sessions visible.

When `session_register` carries `visibilityIntent`, the explicit intent SHALL win over the heuristic: `"hidden"` forces `hidden = true`, `"visible"` forces `hidden = false`.

When the `session_register` message omits `hasUI` (legacy bridge), the server SHALL NOT auto-hide (the session registers with `hidden = false` as before).

#### Scenario: Headless non-dashboard worker is hidden by default
- **WHEN** a session first registers with `hasUI === false` and `source !== "dashboard"` and no `visibilityIntent`
- **THEN** the server SHALL set `hidden = true`
- **AND** the card SHALL be absent from the default list and revealable via `Show hidden`

#### Scenario: TUI and dashboard sessions stay visible
- **WHEN** a session first registers with `hasUI === true`, OR with `source === "dashboard"`
- **THEN** the server SHALL set `hidden = false`

#### Scenario: Explicit visibility intent overrides the heuristic
- **WHEN** a session first registers with `visibilityIntent === "visible"` and `hasUI === false`
- **THEN** the server SHALL set `hidden = false`
- **AND WHEN** a session first registers with `visibilityIntent === "hidden"` and `hasUI === true`
- **THEN** the server SHALL set `hidden = true`

### Requirement: Auto-hide is one-shot; manual hide state survives re-registration

The auto-hide heuristic SHALL be evaluated only on the first registration of a session. On any subsequent `session_register` that the bridge tags with `registerReason: "reattach"` (a reconnect after a dashboard restart while the bridge stayed alive), the server SHALL preserve the existing `hidden` value rather than recomputing it. In-process new/fork/resume registers are tagged `registerReason: "spawn"` with a fresh `sessionId` and are therefore treated as first registers. This ensures a session a user has manually unhidden (or hidden) keeps that state across the worker's reconnects.

#### Scenario: Manual unhide survives reconnect
- **WHEN** an auto-hidden session is manually unhidden, then re-registers (reattach)
- **THEN** the server SHALL keep `hidden = false`
- **AND** SHALL NOT re-apply the auto-hide heuristic
