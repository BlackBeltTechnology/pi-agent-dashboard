## ADDED Requirements

### Requirement: Config file schema additions for diagram rendering

The shared config module SHALL include new optional fields:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `kroki.url` | string \| undefined | undefined | Base URL of a Kroki instance used for diagram rendering |
| `kroki.allowRemote` | boolean | false | Opt-in to rendering via the public kroki.io when no URL is configured |

An environment variable override for the Kroki URL SHALL be read live at request time rather than seeded into config.

#### Scenario: Config with kroki fields
- **WHEN** `~/.pi/dashboard/config.json` contains `{ "kroki": { "url": "http://localhost:8100" } }`
- **THEN** `loadConfig()` SHALL return `kroki.url` as `"http://localhost:8100"`

#### Scenario: Missing kroki section
- **WHEN** the config does not include `kroki`
- **THEN** `loadConfig()` SHALL return `kroki.url` undefined and `kroki.allowRemote` false

#### Scenario: Environment override wins live
- **WHEN** the Kroki URL environment override is set while the config field is absent
- **THEN** the resolved diagram endpoint uses the environment value without a config rewrite or restart
