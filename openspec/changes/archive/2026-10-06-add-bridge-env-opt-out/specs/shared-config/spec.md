## ADDED Requirements

### Requirement: `bridge.enabled` config field
The config loader SHALL support an optional `bridge: { enabled: boolean }` object. `loadConfig()` SHALL always expose `bridge.enabled`. An absent object, an absent `enabled`, or a non-boolean `enabled` SHALL load as `true`. A missing, empty or unparseable config file SHALL load as `bridge.enabled: true`. The key SHALL NOT be seeded by `ensureConfig()`. The `PI_DASHBOARD_BRIDGE` env value overrides this field per process (see `bridge-activation-opt-out`).

#### Scenario: Absent key defaults to enabled
- **WHEN** `config.json` has no `bridge` key
- **THEN** `loadConfig().bridge.enabled` SHALL be `true`

#### Scenario: Explicit false is honoured
- **WHEN** `config.json` holds `{ "bridge": { "enabled": false } }`
- **THEN** `loadConfig().bridge.enabled` SHALL be `false`

#### Scenario: Non-boolean value defaults to enabled
- **WHEN** `config.json` holds `{ "bridge": { "enabled": "no" } }`
- **THEN** `loadConfig().bridge.enabled` SHALL be `true`

#### Scenario: Unreadable file defaults to enabled
- **WHEN** `config.json` is missing, empty, or holds unparseable JSON
- **THEN** `loadConfig().bridge.enabled` SHALL be `true`

#### Scenario: ensureConfig does not seed the key
- **WHEN** `ensureConfig()` creates a fresh config file
- **THEN** the written file SHALL NOT contain a `bridge` key
