## MODIFIED Requirements

### Requirement: Custom event groups SHALL be defined in a user-editable config file
The dashboard SHALL read custom event group definitions from `custom-event-groups.json` in the dashboard config
directory (alongside `config.json`, `preferences.json`, and `tool-overrides.json`). The file SHALL contain a numeric
`version`, an ordered `groups` array, and a `seenShippedIds` array of group ids that have already been offered by a
shipped default. Each group SHALL carry a `id` (stable, opaque, kebab-case), a human-readable `label`, a `pattern`
string interpreted as a regular expression matched against `customType`, and a boolean `default` visibility.

The file SHALL be created with shipped defaults when absent. The `id` SHALL be the group's identity for all persistence
and merge purposes; `pattern` and `label` SHALL be freely editable by the user without losing that identity.

#### Scenario: Missing file is seeded with shipped defaults
- **WHEN** the server starts and `custom-event-groups.json` does not exist
- **THEN** it SHALL create the file containing the shipped default groups
- **AND** `seenShippedIds` SHALL list every shipped group id present in that file

#### Scenario: Editing a pattern preserves group identity
- **GIVEN** a stored group with `id: "memory"` and `pattern: "^om\\."`
- **WHEN** the user edits its `pattern` to `"^om\\.observations\\."` or changes its `label`
- **THEN** the group SHALL still be identified as `memory`
- **AND** its persisted visibility preference SHALL be retained

#### Scenario: Shipped defaults cover the known emitters
- **WHEN** the shipped defaults are seeded
- **THEN** they SHALL include groups covering memory telemetry (`om.` prefixed types), web search results, subagent
  entries, flows help, goal-plugin entries, and diagnostics (subagent admission refusals,
  `subagent-admission-refused`)
- **AND** the memory telemetry group and the diagnostics group SHALL default to hidden
- **AND** every other shipped group SHALL default to visible

#### Scenario: Admission refusal resolves to diagnostics, not the catch-all
- **GIVEN** the shipped defaults
- **WHEN** the `customType` `subagent-admission-refused` is resolved
- **THEN** it SHALL resolve to the `diagnostics` group
- **AND** it SHALL NOT resolve to the `subagents` group or the catch-all `other` group

#### Scenario: Existing config gains diagnostics hidden
- **GIVEN** an existing `custom-event-groups.json` whose `seenShippedIds` does not contain `diagnostics`
- **AND** no group earlier in the file matches `subagent-admission-refused`
- **WHEN** the server starts
- **THEN** the `diagnostics` group SHALL be appended with `default: false`
- **AND** a previously visible `subagent-admission-refused` row SHALL no longer render unless the user enables
  `diagnostics`

#### Scenario: Earlier user rule keeps claiming refusals
- **GIVEN** an existing file with a user-authored group, earlier than `diagnostics`, whose pattern matches
  `subagent-admission-refused`
- **WHEN** `diagnostics` is merged in
- **THEN** `subagent-admission-refused` SHALL continue to resolve to the user's group
