## ADDED Requirements

### Requirement: Reattach placement config field
The shared config module SHALL include a new field that governs how the server places re-registering bridges in `sessionOrder` after a dashboard restart:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `reattachPlacement` | `"preserve" \| "streaming-only" \| "always"` | `"always"` | Policy applied when a bridge sends `session_register` with `registerReason: "reattach"` |

Invalid values (anything outside the union) SHALL fall back to the default `"always"`.

`ensureConfig()` SHALL NOT include `reattachPlacement` in the written defaults — the loader's default-coalescing handles missing values, keeping the on-disk file minimal.

#### Scenario: Config with reattachPlacement preserve
- **WHEN** `~/.pi/dashboard/config.json` contains `{ "reattachPlacement": "preserve" }`
- **THEN** `loadConfig()` SHALL return `reattachPlacement: "preserve"`

#### Scenario: Config with reattachPlacement streaming-only
- **WHEN** `~/.pi/dashboard/config.json` contains `{ "reattachPlacement": "streaming-only" }`
- **THEN** `loadConfig()` SHALL return `reattachPlacement: "streaming-only"`

#### Scenario: Config with reattachPlacement always
- **WHEN** `~/.pi/dashboard/config.json` contains `{ "reattachPlacement": "always" }`
- **THEN** `loadConfig()` SHALL return `reattachPlacement: "always"`

#### Scenario: Empty or missing reattachPlacement defaults to always
- **WHEN** `~/.pi/dashboard/config.json` does not include `reattachPlacement`
- **THEN** `loadConfig()` SHALL return `reattachPlacement: "always"`

#### Scenario: Invalid reattachPlacement falls back to always
- **WHEN** `~/.pi/dashboard/config.json` contains `{ "reattachPlacement": "wibble" }`
- **THEN** `loadConfig()` SHALL return `reattachPlacement: "always"`

#### Scenario: ensureConfig excludes reattachPlacement
- **WHEN** `ensureConfig()` creates a new config file
- **THEN** it SHALL NOT include `reattachPlacement` in the written defaults
