## ADDED Requirements

### Requirement: The Agent-tick throttle SHALL be on by default

`DEFAULT_CONFIG.subagentTickThrottleMs` in `packages/shared/src/config.ts` SHALL be `500`. A configured value of `0` SHALL still disable the throttle (existing semantics preserved).

#### Scenario: default config enables the throttle

- **WHEN** no `subagentTickThrottleMs` is present in the config file
- **THEN** the resolved config SHALL have `subagentTickThrottleMs === 500`

#### Scenario: explicit zero disables

- **GIVEN** the config file sets `subagentTickThrottleMs: 0` and the migration marker is present
- **WHEN** config is loaded
- **THEN** the resolved value SHALL be `0` and the bridge SHALL forward every tick

### Requirement: A one-shot migration SHALL move a materialized zero to the new default

`ensureConfig()` writes `subagentTickThrottleMs` into `~/.pi/dashboard/config.json` on first run, so existing installs carry a materialized `0` that the parser honours as explicit. At server boot only (beside `ensureConfig()`), when the stored `subagentTickThrottleMs` is `0` AND the marker key `subagentTickThrottleMigrated` is absent, the server SHALL rewrite the stored value to `500` and SHALL set the marker, using the merge-preserving `writeConfigPartial` writer. The migration SHALL NOT run in `loadConfig`, which is a pure read executed by every bridge process. The marker SHALL be declared on `DashboardConfig` so a settings round-trip preserves it, and SHALL ALSO be written unconditionally by `ensureConfig()` on a fresh install — otherwise a fresh install never carries the marker and a `0` the user chooses later is indistinguishable from a legacy materialized `0`. The marker, not the value, SHALL decide: a `0` stored while the marker is present SHALL be preserved.

#### Scenario: legacy materialized zero migrates

- **GIVEN** a config file with `subagentTickThrottleMs: 0` and no marker
- **WHEN** the server boots
- **THEN** the resolved value SHALL be `500`
- **AND** the file SHALL contain `subagentTickThrottleMs: 500` and the marker

#### Scenario: deliberate zero after migration survives

- **GIVEN** a config file with `subagentTickThrottleMs: 0` and the marker present
- **WHEN** the server boots
- **THEN** the resolved value SHALL be `0` and the file SHALL be unchanged

#### Scenario: a customized non-zero value is never touched

- **GIVEN** a config file with `subagentTickThrottleMs: 250` and no marker
- **WHEN** the server boots
- **THEN** the resolved value SHALL be `250`

#### Scenario: unrelated config keys survive the migration

- **GIVEN** a config file carrying user keys outside the `ensureConfig()` seed set
- **WHEN** the migration runs
- **THEN** every unrelated key SHALL be preserved

#### Scenario: a fresh install is born migrated

- **WHEN** `ensureConfig()` creates a new `config.json`
- **THEN** the file SHALL contain the marker
- **AND** a `0` written by the user afterwards SHALL survive the next boot

#### Scenario: a bridge process never migrates

- **WHEN** `loadConfig` is called from a bridge process
- **THEN** no write to `config.json` SHALL occur
