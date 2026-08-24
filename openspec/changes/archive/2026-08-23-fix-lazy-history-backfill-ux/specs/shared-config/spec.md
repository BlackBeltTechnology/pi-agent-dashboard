## MODIFIED Requirements

### Requirement: `memoryLimits.maxReplayEvents` config field

The config schema SHALL include `memoryLimits.maxReplayEvents`, a number bounding how many events a full-stream session replay delivers to a browser. `0` SHALL mean unlimited. The default SHALL be a positive window rather than unlimited, so a long session opens bounded without configuration. Every layer that supplies a fallback for this field SHALL supply the same default.

#### Scenario: Absent field defaults to the bounded window

- **WHEN** a config file contains a `memoryLimits` object without `maxReplayEvents`
- **THEN** the parsed config SHALL report the positive default window
- **AND** every other `memoryLimits` value SHALL be unchanged

#### Scenario: Explicit zero still means unlimited

- **WHEN** a config file sets `maxReplayEvents` to `0`
- **THEN** the parsed config SHALL report `0`
- **AND** session replay SHALL be unbounded

#### Scenario: A session smaller than the default is unaffected

- **WHEN** a session's compacted replay contains fewer events than the default window
- **THEN** replay SHALL deliver the same events it delivered before the default changed
- **AND** no `history_window` SHALL be announced

#### Scenario: Configured value is threaded to the server

- **WHEN** `maxReplayEvents` is set to a positive number in the config file
- **THEN** the running server SHALL apply that value when windowing a full-stream replay

#### Scenario: A server given no explicit value uses the default

- **WHEN** a server is constructed without an explicit `maxReplayEvents` in its handler context
- **THEN** it SHALL apply the positive default window rather than unlimited

### Requirement: `maxReplayEvents` is validated to a minimum viable window

A positive `maxReplayEvents` below the minimum viable window SHALL be clamped up to that minimum, so a configured window can never be too small to contain a head segment. Parsing SHALL treat an absent, negative, or non-numeric value as unset and report the default, while preserving an explicit `0` as unlimited.

#### Scenario: Below-minimum positive value is clamped

- **WHEN** `maxReplayEvents` is set to `5`
- **THEN** the parsed config SHALL report the minimum viable window rather than `5`

#### Scenario: Zero is preserved rather than clamped

- **WHEN** `maxReplayEvents` is set to `0`
- **THEN** the parsed config SHALL report `0`

#### Scenario: Non-numeric value falls back to the default

- **WHEN** `maxReplayEvents` is present but not a number
- **THEN** the parsed config SHALL report the default window

#### Scenario: Negative value falls back to the default

- **WHEN** `maxReplayEvents` is set to `-1`
- **THEN** the parsed config SHALL report the default window
