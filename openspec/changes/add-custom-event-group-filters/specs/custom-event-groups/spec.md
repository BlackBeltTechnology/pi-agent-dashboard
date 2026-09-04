## Purpose

Groups the open, runtime-discovered keyspace of custom chat entry types (`customType`) into a small set of named,
user-toggleable categories defined by regex patterns in a user-editable config file, so custom chat noise can be hidden
per category instead of all-or-nothing, and so the global settings surface can enumerate the categories without a
session open.

## ADDED Requirements

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
  entries, flows help, and goal-plugin entries
- **AND** the memory telemetry group SHALL default to hidden
- **AND** every other shipped group SHALL default to visible

### Requirement: Group resolution SHALL be first-match-wins and total
Resolving a `customType` to a group SHALL evaluate the `groups` array in order and select the first group whose
`pattern` matches. A `customType` matching no group SHALL resolve to the reserved catch-all group `other`, which SHALL
always exist and SHALL NOT be removable by editing the file. `customType: "flow-event"` SHALL NOT be resolved to any
group and SHALL retain its dedicated rendering path.

#### Scenario: First matching group wins
- **GIVEN** an ordered `groups` array where a user-authored pattern `^om\.observations\.` precedes the shipped `^om\.`
- **WHEN** `om.observations.recorded` is resolved
- **THEN** it SHALL resolve to the earlier user-authored group
- **AND** the later group SHALL NOT claim it

#### Scenario: Unmatched type falls into the catch-all
- **WHEN** a `customType` emitted by a third-party extension matches no configured pattern
- **THEN** it SHALL resolve to the `other` group
- **AND** its visibility SHALL follow the `other` group's toggle

#### Scenario: Catch-all survives a file that omits it
- **GIVEN** a `custom-event-groups.json` whose `groups` array contains no `other` entry
- **WHEN** the configuration is loaded
- **THEN** the `other` group SHALL still be available for resolution and SHALL be offered as a toggle

#### Scenario: flow-event is never grouped
- **WHEN** a chat row carries `customType: "flow-event"`
- **THEN** group resolution SHALL NOT be applied to it
- **AND** its visibility SHALL NOT depend on any custom event group toggle

### Requirement: Invalid group configuration SHALL fail open
Malformed configuration SHALL never blank the chat. If the file is unparseable, or if `groups` is not an array, the
system SHALL fall back to the shipped defaults. If an individual group entry is invalid — missing `id`, duplicate `id`,
missing or uncompilable `pattern` — that entry SHALL be skipped while every valid entry is retained. A `customType`
whose group cannot be determined for any reason SHALL be treated as visible.

#### Scenario: Unparseable file falls back to defaults
- **WHEN** `custom-event-groups.json` contains invalid JSON
- **THEN** the shipped default groups SHALL be used
- **AND** the failure SHALL be logged
- **AND** the user's file SHALL NOT be overwritten or deleted

#### Scenario: Invalid regex skips only its own group
- **GIVEN** a `groups` array where one entry has an uncompilable `pattern`
- **WHEN** the configuration is loaded
- **THEN** that entry SHALL be skipped
- **AND** every other entry SHALL remain active
- **AND** types that would have matched the skipped entry SHALL resolve to a later matching group or to `other`

#### Scenario: Duplicate id is rejected without breaking the file
- **GIVEN** two group entries sharing the same `id`
- **WHEN** the configuration is loaded
- **THEN** the first entry SHALL be kept and the later duplicate SHALL be skipped

### Requirement: Group resolution SHALL be bounded in the chat render path
Pattern matching SHALL NOT be re-executed per rendered row. The system SHALL resolve each distinct `customType` at most
once per loaded configuration and reuse the result, so that rendering cost is bounded by the number of distinct
`customType` values rather than by the number of chat rows. A user-authored pattern SHALL NOT be able to block the UI
thread indefinitely: pattern evaluation SHALL be guarded so that a catastrophically-backtracking expression is abandoned
and its group skipped rather than freezing the chat.

#### Scenario: Repeated types resolve once
- **GIVEN** a session containing many rows sharing one `customType`
- **WHEN** the chat renders and re-renders
- **THEN** the `customType` SHALL be matched against the patterns at most once per loaded configuration

#### Scenario: Pathological pattern does not freeze the UI
- **GIVEN** a group whose `pattern` exhibits catastrophic backtracking against some `customType`
- **WHEN** that type is resolved
- **THEN** evaluation SHALL be abandoned rather than run unbounded
- **AND** the offending group SHALL be skipped
- **AND** the chat SHALL continue to render

#### Scenario: Configuration reload invalidates the resolution cache
- **WHEN** the loaded configuration changes
- **THEN** previously resolved `customType` results SHALL be discarded and re-resolved against the new configuration

### Requirement: Newly shipped groups SHALL merge without resurrecting removed ones
When the shipped defaults gain a group that an existing `custom-event-groups.json` does not contain, that group SHALL be
added to the user's file only if its `id` is absent from `seenShippedIds`. Merged groups SHALL be appended after
user-authored entries so an existing broader user rule keeps winning under first-match-wins. Every shipped id offered
SHALL be recorded in `seenShippedIds`, whether or not the user subsequently keeps the group.

#### Scenario: Genuinely new shipped group is added
- **GIVEN** a stored file whose `seenShippedIds` does not contain `newthing`
- **WHEN** a release ships a `newthing` group and the configuration is loaded
- **THEN** the `newthing` group SHALL be appended to the user's `groups`
- **AND** `newthing` SHALL be added to `seenShippedIds`

#### Scenario: Deleted group stays deleted
- **GIVEN** a user deleted the shipped `memory` group from their file
- **AND** `seenShippedIds` still contains `memory`
- **WHEN** the configuration is loaded on this and every subsequent release
- **THEN** the `memory` group SHALL NOT be re-added

#### Scenario: Merged group is appended after user rules
- **GIVEN** a user-authored group whose pattern also matches types the newly shipped group targets
- **WHEN** the new shipped group is merged
- **THEN** it SHALL be appended after the user-authored group
- **AND** first-match-wins SHALL continue to route those types to the user-authored group

### Requirement: Group definitions SHALL be readable by the client
The server SHALL expose the resolved group definitions (id, label, and default visibility, in resolution order) to the
client, so both the global settings surface and the per-session chat surface can render one toggle per group without a
session or a loaded message stream. Regex patterns are a server-side concern and need not be transmitted.

#### Scenario: Global settings enumerates groups with no session open
- **WHEN** the settings surface is opened with no session selected
- **THEN** it SHALL be able to list every configured group with its label
- **AND** the list SHALL NOT depend on scanning chat messages for observed `customType` values

#### Scenario: Group list reflects the user's file
- **GIVEN** a user added a group to `custom-event-groups.json` and reloaded the configuration
- **WHEN** the client next reads the group definitions
- **THEN** the new group SHALL appear in the list in its configured order
