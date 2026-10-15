## ADDED Requirements

### Requirement: Question brief config fields

The dashboard config SHALL accept `questions.autoBrief` (boolean, default `true`)
and `questions.minBriefChars` (integer, default `240`, clamped to `0`–`4000`).
Missing or invalid values SHALL resolve to the defaults, and the defaults SHALL
NOT be written to the config file by config initialization.

#### Scenario: Defaults

- **WHEN** the config file has no `questions` key
- **THEN** `autoBrief` SHALL resolve to `true` and `minBriefChars` to `240`

#### Scenario: Out-of-range minimum

- **WHEN** `questions.minBriefChars` is `100000`
- **THEN** it SHALL resolve to `4000`

#### Scenario: Invalid type

- **WHEN** `questions.autoBrief` is `"yes"`
- **THEN** it SHALL resolve to `true`
