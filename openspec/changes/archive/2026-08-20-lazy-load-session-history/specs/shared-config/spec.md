## ADDED Requirements

### Requirement: `memoryLimits.maxReplayEvents` config field

The config schema SHALL include `memoryLimits.maxReplayEvents`, a number bounding how many events a full-stream session replay delivers to a browser. `0` SHALL mean unlimited. The default SHALL be `0`.

#### Scenario: Absent field defaults to unlimited

- **WHEN** a config file contains a `memoryLimits` object without `maxReplayEvents`
- **THEN** the parsed config SHALL report `maxReplayEvents` of `0`
- **AND** every other `memoryLimits` value SHALL be unchanged

#### Scenario: Existing config files behave identically

- **WHEN** a config file written before this field existed is loaded
- **THEN** session replay SHALL deliver the same events it delivered before the field existed

#### Scenario: Configured value is threaded to the server

- **WHEN** `maxReplayEvents` is set to a positive number in the config file
- **THEN** the running server SHALL apply that value when windowing a full-stream replay

### Requirement: `maxReplayEvents` is validated to a minimum viable window

A positive `maxReplayEvents` below the minimum viable window SHALL be clamped up to that minimum, so a configured window can never be too small to contain a head segment. A negative value SHALL be treated as unset and SHALL parse to `0`.

#### Scenario: Below-minimum positive value is clamped

- **WHEN** `maxReplayEvents` is set to `5`
- **THEN** the parsed config SHALL report the minimum viable window rather than `5`

#### Scenario: Zero is preserved rather than clamped

- **WHEN** `maxReplayEvents` is set to `0`
- **THEN** the parsed config SHALL report `0`

#### Scenario: Non-numeric value falls back to the default

- **WHEN** `maxReplayEvents` is present but not a number
- **THEN** the parsed config SHALL report `0`

#### Scenario: Negative value falls back to unlimited

- **WHEN** `maxReplayEvents` is set to `-1`
- **THEN** the parsed config SHALL report `0`
- **AND** replay SHALL be unbounded rather than clamped to the minimum window
