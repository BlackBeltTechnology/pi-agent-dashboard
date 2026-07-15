# chat-display-preferences Specification (delta)

## ADDED Requirements

### Requirement: Reserve-process-line-at-idle display preference
`DisplayPrefs` SHALL include a boolean field `reserveProcessLineAtIdle` that controls whether a session card's PROCESS region keeps one line of reserved height while the session is idle. It SHALL be part of all three presets and of the sparse merge, exactly like other top-level `DisplayPrefs` booleans.

#### Scenario: Field present in every preset
- **GIVEN** the `DISPLAY_PRESETS` map
- **WHEN** any preset is read
- **THEN** it SHALL define `reserveProcessLineAtIdle` as a boolean
- **AND** `simple` and `standard` SHALL default it to `false`
- **AND** `everything` SHALL default it to `true`

#### Scenario: Per-session override wins over global
- **GIVEN** global prefs with `reserveProcessLineAtIdle: false`
- **AND** a per-session override with `reserveProcessLineAtIdle: true`
- **WHEN** `mergeDisplayPrefs(global, override)` is evaluated
- **THEN** the effective value SHALL be `true`

#### Scenario: Absent override falls back to global
- **GIVEN** global prefs with `reserveProcessLineAtIdle: true`
- **AND** a per-session override that omits `reserveProcessLineAtIdle`
- **WHEN** `mergeDisplayPrefs(global, override)` is evaluated
- **THEN** the effective value SHALL be `true`

#### Scenario: Configurable from the settings surfaces
- **GIVEN** the global Settings panel
- **WHEN** the user toggles "Reserve process line at idle"
- **THEN** the global `reserveProcessLineAtIdle` SHALL be patched
- **AND** the per-session chat-view menu SHALL expose the same control as an override, marked when it differs from global
