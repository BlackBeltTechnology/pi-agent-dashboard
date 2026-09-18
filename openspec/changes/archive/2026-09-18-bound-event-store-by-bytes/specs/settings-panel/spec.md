## ADDED Requirements

### Requirement: Memory Limits section exposes `maxBytesPerSession`

The Memory Limits section of the settings panel SHALL expose a numeric control for `memoryLimits.maxBytesPerSession`, alongside the existing memory-limit controls, labelled in mebibytes for the operator and stored in bytes, with a hint explaining that `0` disables the bound and that the oldest tool/subagent noise is dropped first. The control's label and hint SHALL resolve through the translation layer with an English fallback, consistent with the sibling controls.

#### Scenario: Control renders with the configured value

- **WHEN** the settings panel loads with `maxBytesPerSession` set to `33554432`
- **THEN** the Memory Limits section SHALL display a control showing `32`

#### Scenario: Control renders the default when the field is absent

- **WHEN** the settings panel loads a config with no `maxBytesPerSession`
- **THEN** the control SHALL display the default the server applies (`32`)

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

### Requirement: Memory Limits section exposes the global budget and resident count

The Memory Limits section SHALL additionally expose numeric controls for
`memoryLimits.maxTotalEventBytes` (labelled in mebibytes, stored in bytes) and
`memoryLimits.maxCachedSessions` (a plain count). Both SHALL follow the sibling
controls' conventions: translated label and hint with an English fallback,
partial config write, and a restart-required indication. The `maxTotalEventBytes`
hint SHALL state that it bounds ALL sessions together and that whole idle
sessions are evicted first; the `maxCachedSessions` hint SHALL state that evicted
sessions are re-read from their transcript when reopened.

#### Scenario: Global budget control renders the configured value

- **WHEN** the settings panel loads with `maxTotalEventBytes` set to `805306368`
- **THEN** the section SHALL display a control showing `768`

#### Scenario: Resident count renders the default when absent

- **WHEN** the settings panel loads a config with no `maxCachedSessions`
- **THEN** the control SHALL display `32`

#### Scenario: Editing one new control does not pin the other

- **WHEN** the user changes only `maxCachedSessions` and saves
- **THEN** the config write SHALL include `memoryLimits.maxCachedSessions`
- **AND** SHALL NOT include `maxTotalEventBytes` or `maxBytesPerSession`
