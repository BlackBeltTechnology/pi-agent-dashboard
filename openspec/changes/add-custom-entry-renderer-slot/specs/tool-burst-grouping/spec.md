## MODIFIED Requirements

### Requirement: Transparent-row absorption

The system SHALL treat certain non-tool rows as transparent so they never terminate a burst run: `thinking`, `turnSeparator`, `rawEvent`, `commandFeedback`, and `assistant` rows whose content is empty (whitespace-only). Transparent rows appearing before a run (leading), between members (interior), or after the last member up to the next hard boundary (trailing) SHALL be absorbed into the burst group's `items`, so a turn's opening plan reasoning and concluding reasoning fold inside the group.

The system SHALL additionally treat a `custom` row as transparent WHEN AND ONLY WHEN its
`customType` is claimed by a `custom-entry-renderer` contribution. A `custom` row with no
matching claim SHALL remain a hard boundary. Transparency SHALL therefore depend only on the set
of registered claims, never on display preferences, so toggling a custom event group SHALL NOT
re-form bursts.

The inner repetitive-run pass maintains its own, DIFFERENT transparent-row set and independently
ends its run on a `custom` row; the matching change there is specified by the
`consecutive-tool-call-grouping` capability. Applying conditional transparency to only one of the
two passes SHALL be treated as incomplete.

The claimed-type set SHALL be read once per transcript grouping rather than re-evaluated live, so
that claims registering asynchronously after first render re-group at most once and never
reshuffle a transcript the user is already reading.

#### Scenario: Interior thinking does not break a burst

- WHEN two `toolResult` rows are separated by a `thinking` row
- THEN both `toolResult` rows SHALL belong to the same burst
- AND the `thinking` row SHALL be absorbed into that burst between them

#### Scenario: Trailing reasoning folds into the burst

- WHEN a `thinking` row follows the last `toolResult` of a run and precedes a hard boundary
- THEN the trailing `thinking` row SHALL be absorbed into the burst group
- AND the burst window SHALL end at that trailing transparent

#### Scenario: Empty assistant prose is transparent

- WHEN an `assistant` row with whitespace-only content sits between two tool-like items
- THEN it SHALL be absorbed as a transparent member and SHALL NOT terminate the burst

#### Scenario: Claimed custom row is absorbed

- WHEN two `toolResult` rows are separated by a `custom` row whose `customType` is claimed by a
  `custom-entry-renderer` contribution
- THEN both `toolResult` rows SHALL belong to the same burst
- AND the `custom` row SHALL be absorbed into that burst between them

#### Scenario: Unclaimed custom row still terminates the burst

- WHEN two `toolResult` rows are separated by a `custom` row whose `customType` is claimed by no
  contribution
- THEN they SHALL belong to two separate bursts
- AND the `custom` row SHALL be emitted verbatim at the top level

#### Scenario: Lone repetitive group flanked by a claimed custom row is wrapped

- GIVEN a single `×N` group whose only absorbed neighbour is a claimed `custom` row
- WHEN the burst pass runs
- THEN the bare-group exception SHALL NOT apply, because a claimed custom row is content rather
  than structural chrome
- AND the group SHALL be wrapped in a burst container together with that row

#### Scenario: Burst formation is unchanged with no claims registered

- GIVEN no `custom-entry-renderer` contribution is registered
- WHEN the chat groups a message stream containing `custom` rows
- THEN the resulting burst structure SHALL be identical to the structure produced before
  conditional custom transparency existed

#### Scenario: Display preferences do not re-form bursts

- GIVEN a claimed `custom` row absorbed into a burst
- WHEN the user toggles that row's custom event group off and on
- THEN the burst structure SHALL NOT change
- AND only the absorbed row's visibility SHALL change
