# bridge-session-visibility-intent Specification

## Purpose

The bridge forwards optional visibility hints to the dashboard server as part of a session's `session_register` payload. These hints let the server decide whether to auto-hide a session (e.g. a headless worker with no interactive UI). The bridge only forwards facts derived from its environment and session context; it never decides hide/show itself — the server owns that policy.

## Requirements

### Requirement: Environment-driven visibility intent resolution

The bridge SHALL derive an explicit visibility intent from its process environment, forwarding it only when the operator has set an override.

#### Scenario: Neither override present
- **WHEN** neither `PI_DASHBOARD_VISIBLE` nor `PI_DASHBOARD_HIDDEN` is set in the environment
- **THEN** the resolved visibility intent SHALL be undefined
- **AND** the server SHALL be left to apply its own auto-hide heuristic

#### Scenario: Hide override present
- **WHEN** `PI_DASHBOARD_HIDDEN` is set and `PI_DASHBOARD_VISIBLE` is not set
- **THEN** the resolved visibility intent SHALL be `"hidden"`

#### Scenario: Show override present
- **WHEN** `PI_DASHBOARD_VISIBLE` is set
- **THEN** the resolved visibility intent SHALL be `"visible"`

#### Scenario: Explicit show wins over hide
- **WHEN** both `PI_DASHBOARD_VISIBLE` and `PI_DASHBOARD_HIDDEN` are set
- **THEN** the resolved visibility intent SHALL be `"visible"`

### Requirement: Optional visibility fields in session_register

The bridge SHALL attach an optional `{ hasUI?, visibilityIntent? }` slice to the `session_register` payload, omitting each field when its value is absent so that legacy on-the-wire behavior is preserved.

#### Scenario: Headless worker with no UI
- **WHEN** the session has no interactive UI (`hasUI` is `false`)
- **THEN** the `session_register` payload SHALL carry `hasUI: false`
- **AND** the server MAY use that fact to auto-hide the headless worker session

#### Scenario: Interactive UI session
- **WHEN** the session has an interactive UI (`hasUI` is `true`)
- **THEN** the `session_register` payload SHALL carry `hasUI: true`

#### Scenario: UI state unknown
- **WHEN** the session's UI state is unknown (`hasUI` is undefined)
- **THEN** the `hasUI` field SHALL be omitted entirely from the payload

#### Scenario: Intent forwarded alongside hasUI
- **WHEN** an explicit visibility intent is resolved from the environment
- **THEN** the `session_register` payload SHALL include `visibilityIntent` set to `"hidden"` or `"visible"` alongside any `hasUI` field

#### Scenario: No intent override
- **WHEN** no explicit visibility intent is resolved from the environment
- **THEN** the `visibilityIntent` field SHALL be omitted entirely from the payload
