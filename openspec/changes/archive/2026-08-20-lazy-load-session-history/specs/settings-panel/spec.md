## ADDED Requirements

### Requirement: Memory Limits section exposes `maxReplayEvents`

The Memory Limits section of the settings panel SHALL expose a numeric control for `memoryLimits.maxReplayEvents`, alongside the existing memory-limit controls, with a hint explaining that `0` disables the bound and that earlier history remains loadable on demand.

#### Scenario: Control renders with the configured value

- **WHEN** the settings panel loads with `maxReplayEvents` set to `500`
- **THEN** the Memory Limits section SHALL display a control showing `500`

#### Scenario: Control renders the default when the field is absent

- **WHEN** the settings panel loads a config with no `maxReplayEvents`
- **THEN** the control SHALL display `0`

#### Scenario: Edited value is written back

- **WHEN** the user changes the control to `500` and saves
- **THEN** the config write SHALL include `memoryLimits.maxReplayEvents` of `500`
- **AND** the other `memoryLimits` values SHALL be written unchanged

#### Scenario: Change is marked as requiring a restart

- **WHEN** the user changes the control
- **THEN** the panel SHALL indicate the change requires a server restart, consistent with the other Memory Limits controls

### Requirement: The `maxReplayEvents` control is localized

The control's label and hint SHALL be provided through the translation layer with an English fallback, consistent with the sibling Memory Limits controls.

#### Scenario: Label resolves in each supported locale

- **WHEN** the settings panel renders in a supported locale
- **THEN** the control's label SHALL resolve through the translation layer rather than a hard-coded string
