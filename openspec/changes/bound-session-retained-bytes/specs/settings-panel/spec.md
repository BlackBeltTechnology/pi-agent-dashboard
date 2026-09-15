## ADDED Requirements

### Requirement: Memory Limits section exposes `maxBytesPerSession`

The Memory Limits section of the settings panel SHALL expose a numeric control for `memoryLimits.maxBytesPerSession`, alongside the existing memory-limit controls, labelled in mebibytes for the operator and stored in bytes, with a hint explaining that `0` disables the bound and that the oldest tool/subagent noise is dropped first. The control's label and hint SHALL resolve through the translation layer with an English fallback, consistent with the sibling controls.

#### Scenario: Control renders with the configured value

- **WHEN** the settings panel loads with `maxBytesPerSession` set to `33554432`
- **THEN** the Memory Limits section SHALL display a control showing `32`

#### Scenario: Control renders the default when the field is absent

- **WHEN** the settings panel loads a config with no `maxBytesPerSession`
- **THEN** the control SHALL display the default the server applies (`64`)

#### Scenario: Edited value is written back in bytes

- **WHEN** the user changes the control to `32` and saves
- **THEN** the config write SHALL include `memoryLimits.maxBytesPerSession` of `33554432`
- **AND** the other `memoryLimits` values SHALL be preserved on disk

#### Scenario: Saving an unrelated Memory Limits field does not pin `maxBytesPerSession`

- **WHEN** the user changes only `maxEventsPerSession` and saves
- **THEN** the config write SHALL NOT include `maxBytesPerSession`

#### Scenario: Change is marked as requiring a restart

- **WHEN** the user changes the control
- **THEN** the panel SHALL indicate the change requires a server restart, consistent with the other Memory Limits controls
