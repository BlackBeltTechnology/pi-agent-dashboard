## ADDED Requirements

### Requirement: Default thinking level config field

The config schema SHALL include a `defaultThinkingLevel` field of type string with
a default of `""` (empty string). A non-empty value SHALL be one of pi's canonical
thinking levels: `"off"`, `"minimal"`, `"low"`, `"medium"`, `"high"`, `"xhigh"`,
`"max"`. An empty string SHALL mean **"do not override"** — consumers SHALL leave
pi's own thinking-level resolution intact, mirroring the existing `defaultModel: ""`
"do not override" semantics.

Values that are not a string SHALL fall back to the default `""`. The loader SHALL
NOT reject an unrecognized non-empty string at config-load time; validation against
a specific model's capabilities happens where the level is applied (the bridge
clamps via pi) and where it is edited (the Settings control filters).

#### Scenario: Config with defaultThinkingLevel set

- **WHEN** `~/.pi/dashboard/config.json` contains `{ "defaultThinkingLevel": "high" }`
- **THEN** `loadConfig()` SHALL return `defaultThinkingLevel: "high"` with defaults for all other fields

#### Scenario: Config without defaultThinkingLevel

- **WHEN** `~/.pi/dashboard/config.json` does not include `defaultThinkingLevel`
- **THEN** `loadConfig()` SHALL return `defaultThinkingLevel: ""`

#### Scenario: Non-string defaultThinkingLevel falls back to default

- **WHEN** `~/.pi/dashboard/config.json` contains `{ "defaultThinkingLevel": 3 }`
- **THEN** `loadConfig()` SHALL return `defaultThinkingLevel: ""`

#### Scenario: Partial update preserves other fields

- **WHEN** `PUT /api/config` sends a partial `{ "defaultThinkingLevel": "low" }`
- **THEN** the persisted config SHALL set `defaultThinkingLevel: "low"` and leave all other fields unchanged
