## MODIFIED Requirements

### Requirement: Transparent rows do not break a run

The system SHALL treat rows with role `assistant`, `thinking`, `turnSeparator`, `rawEvent`, or `commandFeedback` as transparent while scanning for the next groupable `toolResult`: such rows are skipped and do not terminate the run.

The system SHALL additionally treat a `custom` row as transparent WHEN AND ONLY WHEN its
`customType` is claimed by a `custom-entry-renderer` contribution. A `custom` row with no
matching claim SHALL remain a run-ending boundary. Transparency SHALL depend only on the set of
registered claims, never on display preferences.

An absorbed `custom` row SHALL be rendered inside the expanded group view by the same resolution
chain used at top level (plugin claim, then generic fallback, with the same collapsed
presentation and expand affordance), subject to its custom event group's visibility. Absorption
SHALL change a row's position, never its content or its available interactions. It SHALL NOT be
silently dropped — including when every tool member of the group is hidden by the per-tool call
visibility preference.

#### Scenario: Narration between identical calls is absorbed
- WHEN transparent rows appear between two matching `toolResult` rows in an otherwise-qualifying run
- THEN those rows SHALL NOT end the run
- AND when a group forms, its `rendered` slice SHALL include the absorbed transparent rows in original order alongside the grouped tool calls
- AND the absorbed transparent rows SHALL render only inside the expanded group view, not as standalone collapsed-timeline rows

#### Scenario: Trailing transparent rows after the last grouped call are not consumed
- WHEN transparent rows follow the final grouped `toolResult`
- THEN the group SHALL end at the last consumed `toolResult`
- AND the trailing transparent rows SHALL remain for the next scan iteration rather than being absorbed into the group

#### Scenario: Claimed custom row is absorbed into the run
- WHEN a `custom` row whose `customType` is claimed appears between two matching `toolResult` rows in an otherwise-qualifying run
- THEN it SHALL NOT end the run
- AND it SHALL appear in the group's `rendered` slice in original order

#### Scenario: Unclaimed custom row ends the run
- WHEN a `custom` row whose `customType` is claimed by no contribution appears between two matching `toolResult` rows
- THEN the run SHALL end before that row, as it does today

#### Scenario: Absorbed custom row renders inside the expanded group
- GIVEN a claimed `custom` row absorbed into a group's `rendered` slice
- WHEN the group is expanded and that row's custom event group is visible
- THEN the row SHALL render via its plugin renderer inside the expanded group view

#### Scenario: Hidden group suppresses an absorbed custom row
- GIVEN a claimed `custom` row absorbed into a group's `rendered` slice
- WHEN the group is expanded and that row's custom event group visibility is `false`
- THEN the row SHALL render nothing inside the expanded group view

#### Scenario: Absorbed custom row survives an empty group
- GIVEN a claimed `custom` row absorbed into a group whose tool members are all hidden by the per-tool call visibility preference
- WHEN the group renders and that row's custom event group is visible
- THEN the row SHALL still render
- AND the group SHALL NOT suppress it merely because no tool member survived the per-tool gate

#### Scenario: Grouping is unchanged with no claims registered
- GIVEN no `custom-entry-renderer` contribution is registered
- WHEN the system groups a message stream containing `custom` rows
- THEN the resulting groups SHALL be identical to those produced before conditional custom transparency existed
