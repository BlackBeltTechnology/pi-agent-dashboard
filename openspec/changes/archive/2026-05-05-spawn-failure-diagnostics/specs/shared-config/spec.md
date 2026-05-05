## ADDED Requirements

### Requirement: Configurable spawn-register watchdog timeout
`packages/shared/src/config.ts` SHALL accept a new optional config field `spawnRegisterTimeoutMs: number` in the dashboard config schema loaded from `~/.pi/dashboard/config.json`. The default value SHALL be `30000` (30 seconds). Values SHALL be clamped to the inclusive range `[5000, 120000]` at read time. Non-number / NaN / missing values SHALL fall back to the default.

#### Scenario: default applied when field omitted
- **WHEN** the config file does not contain `spawnRegisterTimeoutMs`
- **THEN** the loader SHALL return `spawnRegisterTimeoutMs: 30000`

#### Scenario: in-range value preserved
- **WHEN** the config file contains `"spawnRegisterTimeoutMs": 45000`
- **THEN** the loader SHALL return `spawnRegisterTimeoutMs: 45000`

#### Scenario: below-range value clamped
- **WHEN** the config file contains `"spawnRegisterTimeoutMs": 1000`
- **THEN** the loader SHALL return `spawnRegisterTimeoutMs: 5000`

#### Scenario: above-range value clamped
- **WHEN** the config file contains `"spawnRegisterTimeoutMs": 999999`
- **THEN** the loader SHALL return `spawnRegisterTimeoutMs: 120000`

#### Scenario: invalid value falls back to default
- **WHEN** the config file contains `"spawnRegisterTimeoutMs": "thirty"` or `null` or `NaN`
- **THEN** the loader SHALL return `spawnRegisterTimeoutMs: 30000`
