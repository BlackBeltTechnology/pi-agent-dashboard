## MODIFIED Requirements

### Requirement: Session register message (extension → server)
The protocol SHALL define a `session_register` message type carrying at least `type: "session_register"`, `sessionId`, `cwd`, and `source`. The message MAY additionally carry the optional fields `hasUI` (boolean) and `visibilityIntent` (`"hidden" | "visible"`).

`hasUI` SHALL reflect whether a TUI is attached to the pi process (`true` for interactive TUI sessions, `false` for headless/print-mode). The bridge populates it from its cached UI state. `visibilityIntent` SHALL be populated from the bridge's environment override (e.g. `PI_DASHBOARD_HIDDEN` / `PI_DASHBOARD_VISIBLE`) when present.

Both fields are optional and back-compatible. When `hasUI` is absent, the server SHALL NOT apply the auto-hide heuristic. When `visibilityIntent` is absent, the server SHALL fall back to the heuristic (or to `hidden = false` when `hasUI` is also absent).

#### Scenario: Headless worker advertises no UI
- **WHEN** a print-mode pi (`pi -p`) registers
- **THEN** the message SHALL carry `hasUI: false`

#### Scenario: Explicit visibility override is forwarded
- **WHEN** the bridge process has `PI_DASHBOARD_HIDDEN` (or `PI_DASHBOARD_VISIBLE`) set
- **THEN** the message SHALL carry `visibilityIntent: "hidden"` (or `"visible"`)

#### Scenario: Legacy bridge omits the fields
- **WHEN** a bridge that predates this change registers
- **THEN** the message SHALL omit `hasUI` and `visibilityIntent`
- **AND** the server SHALL register the session with `hidden = false`
