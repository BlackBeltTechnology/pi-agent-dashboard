## ADDED Requirements

### Requirement: `sessionHeap` and `serverHeap` config blocks

The config file SHALL support two optional top-level object keys, `sessionHeap`
and `serverHeap`, each carrying integer megabyte values.

`sessionHeap` SHALL accept `maxOldSpaceMb` (default `512`), `initialOldSpaceMb`
(no default — absent means unset), and `maxSemiSpaceMb` (no default — absent
means unset). `serverHeap` SHALL accept `maxOldSpaceMb` (default `8192`).

They are two separate top-level keys rather than one nested block because
settings-page attribution resolves per top-level key, and the two blocks belong
to different pages.

These keys are distinct from the existing `memoryLimits` key, which bounds the
in-memory event store. `loadConfig()` SHALL treat them independently; neither
SHALL affect the other's defaults.

#### Scenario: Config omitting both keys
- **WHEN** `~/.pi/dashboard/config.json` contains neither key
- **THEN** `loadConfig()` SHALL return `sessionHeap.maxOldSpaceMb` of `512` and `serverHeap.maxOldSpaceMb` of `8192`
- **AND** `sessionHeap.initialOldSpaceMb` and `sessionHeap.maxSemiSpaceMb` SHALL be absent

#### Scenario: Config with a partial heap block
- **WHEN** the config contains `{ "sessionHeap": { "maxSemiSpaceMb": 8 } }`
- **THEN** `loadConfig()` SHALL return `maxSemiSpaceMb` of `8` and `maxOldSpaceMb` of `512`

#### Scenario: Invalid heap value falls back to the default
- **WHEN** the config contains `{ "sessionHeap": { "maxOldSpaceMb": 0 } }` or a non-numeric value
- **THEN** `loadConfig()` SHALL return the `512` default
- **AND** loading SHALL succeed without error

#### Scenario: Heap keys do not disturb the event-store limits
- **WHEN** the config sets `sessionHeap` but not `memoryLimits`
- **THEN** `loadConfig()` SHALL return the unchanged `memoryLimits` defaults

#### Scenario: Partial config write preserves the heap blocks
- **WHEN** a partial config update is written that does not mention `sessionHeap`
- **THEN** a previously persisted `sessionHeap` SHALL survive the write
