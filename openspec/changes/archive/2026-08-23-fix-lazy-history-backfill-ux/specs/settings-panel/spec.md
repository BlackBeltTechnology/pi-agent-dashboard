## ADDED Requirements

### Requirement: Memory Limits documents the replay-window and retention interaction

The Memory Limits section SHALL carry unconditional help text explaining that event retention bounds what the replay window's elided middle can later serve. It SHALL NOT gate that text on a comparison between `maxReplayEvents` and `maxEventsPerSession`, because whether retention will actually trim the gap depends on a session's eventual size and is not decidable from configuration.

#### Scenario: Help text is always present

- **WHEN** the Memory Limits section renders
- **THEN** the interaction between the replay window and event retention SHALL be explained

#### Scenario: No conditional warning is shown

- **WHEN** `maxReplayEvents` and `maxEventsPerSession` are both positive in any relative ordering
- **THEN** no warning specific to that pairing SHALL be displayed

#### Scenario: Saving is never blocked on the pairing

- **WHEN** the user saves any combination of the two values
- **THEN** the save SHALL NOT be blocked
- **AND** neither value SHALL be rewritten on the basis of the other
- **AND** the existing minimum-replay-window clamp SHALL continue to apply unchanged

#### Scenario: Help text is localized

- **WHEN** the Memory Limits section renders in a supported locale
- **THEN** the help text SHALL resolve through the translation layer rather than a hard-coded string

### Requirement: Saving an unrelated Memory Limits field does not pin `maxReplayEvents`

The settings panel SHALL NOT convert a defaulted `maxReplayEvents` into an explicitly configured one as a side effect of editing a different field. Because the config read returns a parsed config in which the field is always materialized, a whole-object write of `memoryLimits` would persist a value the user never chose.

#### Scenario: Editing a sibling field does not persist the default

- **WHEN** the user edits a different Memory Limits field and saves, having never touched `maxReplayEvents`
- **THEN** the written config SHALL NOT gain an explicit `maxReplayEvents` that the stored config did not already have

#### Scenario: An explicitly configured value survives a sibling edit

- **WHEN** the stored config sets `maxReplayEvents` to `0` and the user edits a different Memory Limits field and saves
- **THEN** the written config SHALL still set `maxReplayEvents` to `0`

#### Scenario: The control displays the effective value

- **WHEN** the settings panel loads a config with no stored `maxReplayEvents`
- **THEN** the control SHALL display the positive default window the server applies
