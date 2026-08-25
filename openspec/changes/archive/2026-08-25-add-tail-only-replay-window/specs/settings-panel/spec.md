## ADDED Requirements

### Requirement: Memory Limits section exposes `replayWindowMode`

The Memory Limits section SHALL expose a control for `memoryLimits.replayWindowMode` alongside the `maxReplayEvents` control, offering both `head-tail` and `tail-only`. Its hint SHALL state the tradeoff — that `tail-only` omits the session's opening messages from the initial view — and SHALL state that the setting applies to every client of this server, not to this browser alone.

#### Scenario: Control reflects the configured mode

- **WHEN** the settings panel loads with `replayWindowMode` set to `tail-only`
- **THEN** the Memory Limits section SHALL display a control showing `tail-only`

#### Scenario: Default is shown when the field is absent

- **WHEN** the settings panel loads a config with no `replayWindowMode`
- **THEN** the control SHALL display `head-tail`

#### Scenario: Saving preserves sibling memory limits

- **WHEN** the user changes only `replayWindowMode` and saves
- **THEN** the config write SHALL include the new `memoryLimits.replayWindowMode`
- **AND** the other `memoryLimits` values SHALL be written unchanged

#### Scenario: The control is inert while windowing is off

- **WHEN** `maxReplayEvents` is `0`
- **THEN** the panel SHALL indicate that the window mode has no effect until a positive window is configured

#### Scenario: Change requires a restart

- **WHEN** the user changes `replayWindowMode`
- **THEN** the panel SHALL indicate the change requires a server restart, consistent with the other Memory Limits controls

#### Scenario: Scope is stated, not implied

- **WHEN** the `replayWindowMode` control is displayed
- **THEN** its hint SHALL state that the setting affects every client connected to this server

### Requirement: The `replayWindowMode` control is localized

The control's label, its option labels, and its hint SHALL be provided through the translation layer with an English fallback, in every language the dashboard ships, consistent with the sibling Memory Limits controls.

#### Scenario: Strings resolve through the translation layer

- **WHEN** the panel renders the `replayWindowMode` control in a supported non-English language
- **THEN** the label, option labels, and hint SHALL render from that language's catalog
- **AND** a missing key SHALL fall back to the English string rather than to a raw key
