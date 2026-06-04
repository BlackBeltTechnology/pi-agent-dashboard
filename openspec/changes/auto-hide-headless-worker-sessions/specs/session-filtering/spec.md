## ADDED Requirements

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

The auto-hide heuristic SHALL be evaluated only on the first registration of a session. On any subsequent `session_register` for an already-known session (reattach after a dashboard restart, in-process resume), the server SHALL preserve the existing `hidden` value rather than recomputing it. This ensures a session a user has manually unhidden (or hidden) keeps that state across the worker's reconnects.

#### Scenario: Manual unhide survives reconnect
- **WHEN** an auto-hidden session is manually unhidden, then re-registers (reattach)
- **THEN** the server SHALL keep `hidden = false`
- **AND** SHALL NOT re-apply the auto-hide heuristic
