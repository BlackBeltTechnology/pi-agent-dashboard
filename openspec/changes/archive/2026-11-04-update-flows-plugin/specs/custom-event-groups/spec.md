# Spec Delta

## MODIFIED Requirements

### Requirement: Group resolution SHALL be first-match-wins and total
Resolving a `customType` to a group SHALL evaluate the `groups` array in order and select the first group whose
`pattern` matches. A `customType` matching no group SHALL resolve to the reserved catch-all group `other`, which SHALL
always exist and SHALL NOT be removable by editing the file. An entry type declared in any plugin's
`replayEntryTypes` SHALL NOT be resolved to any group and SHALL keep its plugin-owned rendering path.

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
- **GIVEN** the flows plugin is enabled and declares `replayEntryTypes: ["flow-event"]`
- **WHEN** a chat row carries `customType: "flow-event"`
- **THEN** group resolution SHALL NOT be applied to it
- **AND** its visibility SHALL NOT depend on any custom event group toggle
