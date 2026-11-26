## MODIFIED Requirements

### Requirement: `keeperLog.capturePiOutput` config field gates keeper pi-output capture
The config SHALL support a `keeperLog` object with a boolean `capturePiOutput` field that controls ALL per-session keeper log output. When `true`, keepers write their lifecycle lines and pi's stdout/stderr into `keeper-<sessionId>.log`, and the server writes keeper startup stderr into `keeper-launch-<sessionId>.log`. When `false`, no keeper log file of either kind is created for a spawn. `loadConfig` SHALL default `keeperLog` to `{ capturePiOutput: false }` (all keeper logging OFF) when the field is absent. A non-object `keeperLog` or a non-boolean `capturePiOutput` SHALL fall back to the default. `ensureConfig` SHALL NOT write `keeperLog` into the on-disk defaults (absent field implies logging OFF). The value SHALL be read at spawn time, so a change applies to the next spawned session without a server restart.

#### Scenario: Default value is false when field absent
- **WHEN** `loadConfig` reads a config with no `keeperLog` key
- **THEN** the resolved config SHALL have `keeperLog.capturePiOutput === false`

#### Scenario: Explicit true is preserved
- **WHEN** the config file contains `{ "keeperLog": { "capturePiOutput": true } }`
- **THEN** the resolved config SHALL have `keeperLog.capturePiOutput === true`

#### Scenario: Non-boolean value falls back to default
- **WHEN** the config file contains `{ "keeperLog": { "capturePiOutput": "yes" } }`
- **THEN** the resolved config SHALL have `keeperLog.capturePiOutput === false`

#### Scenario: Round-trip via PUT /api/config
- **WHEN** a client PUTs `{ "keeperLog": { "capturePiOutput": true } }` to `/api/config`
- **THEN** the value SHALL be persisted and returned on the next config read

#### Scenario: False produces no keeper log files for a spawn
- **WHEN** `keeperLog.capturePiOutput` is false and a headless session is spawned
- **THEN** neither `keeper-<sessionId>.log` nor `keeper-launch-<sessionId>.log` SHALL be created for that session
