## ADDED Requirements

### Requirement: `memoryLimits.replayWindowMode` selects the replay window shape

The config SHALL expose `memoryLimits.replayWindowMode` with the values `head-tail` and `tail-only`. It SHALL default to `head-tail`, so a config that does not set it produces exactly the behavior that shipped before the field existed. An absent, non-string, or unrecognized value SHALL fall back to the default rather than raising. The field SHALL have no effect when `maxReplayEvents` is `0`.

#### Scenario: Absent field preserves prior behavior

- **WHEN** a config omits `replayWindowMode`
- **THEN** the parsed config SHALL report `head-tail`
- **AND** session replay SHALL deliver the same shape it delivered before the field existed

#### Scenario: Unrecognized value falls back to the default

- **WHEN** `replayWindowMode` is set to `tail`, to a number, or to `null`
- **THEN** the parsed config SHALL report `head-tail`
- **AND** parsing SHALL NOT raise

#### Scenario: Configured value is threaded to the server

- **WHEN** `replayWindowMode` is set to `tail-only` in the config file
- **THEN** the running server SHALL apply that shape when windowing a full-stream replay

### Requirement: The replay window mode is server-scoped

`memoryLimits.replayWindowMode` SHALL apply to every client of the server that reads it, exactly as `maxReplayEvents` does. It SHALL NOT be represented as a per-browser, per-device, or per-user preference.

#### Scenario: One setting, every client

- **WHEN** `replayWindowMode` is changed and the server is restarted
- **THEN** every subsequently subscribing client SHALL receive the new window shape
- **AND** no client SHALL be able to select a different shape for itself

## MODIFIED Requirements

### Requirement: `maxReplayEvents` is validated to a minimum viable window

A positive `maxReplayEvents` below the minimum viable window SHALL be clamped up to that minimum, so a configured window can never be small enough to make a transcript degenerate. The clamp SHALL apply in every `replayWindowMode`, including modes with no head segment, so the effective window a user configures does not change when the mode changes. A negative value SHALL be treated as unset and SHALL parse to `0`.

#### Scenario: Below-minimum positive value is clamped

- **WHEN** `maxReplayEvents` is set to `5`
- **THEN** the parsed config SHALL report the minimum viable window rather than `5`

#### Scenario: The clamp is independent of the window mode

- **WHEN** `maxReplayEvents` is set to `5` and `replayWindowMode` is `tail-only`
- **THEN** the parsed config SHALL report the same minimum viable window it reports in `head-tail`

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
