# tool-burst-grouping Specification

## Purpose

Collapse a run of consecutive tool-like items in the chat transcript into a single temporal "burst" group, so an investigation turn (e.g. grep → read → grep → read) renders as one progress-aware block instead of a flat wall of rows. This is the OUTER pass, composed on top of the semantic (`×N`) pass: the semantic pass runs first over the entire message stream and folds identical consecutive tool calls into `×N` groups; the burst pass then walks that mixed output and wraps consecutive tool-like items into burst groups.

## Requirements

### Requirement: Burst formation over consecutive tool-like items

The system SHALL walk the semantic-pass output and collapse every maximal run of consecutive tool-like items into one burst group. A tool-like item is either a `toolResult` row or a semantic `×N` group; each counts as exactly ONE burst member. Grouping is universal with threshold 1: any run of one or more tool-like members forms a burst group (except the bare-group case in a separate requirement). The burst group SHALL carry `type: "burst"` and an `id` equal to the stable id of the first tool-like member (a group contributes its first message's id).

#### Scenario: Single tool call forms a burst

- WHEN the stream contains one `toolResult` row surrounded by hard boundaries
- THEN the row SHALL be wrapped in a burst group with a single member
- AND the burst `id` SHALL be that `toolResult` row's id

#### Scenario: Consecutive differing tool calls form one burst

- WHEN several `toolResult` rows with different tool names appear consecutively (no hard boundary between them)
- THEN they SHALL collapse into one burst group whose `items` preserve their original order
- AND each `toolResult` row SHALL count as one member

#### Scenario: A semantic group counts as one member

- WHEN a semantic `×N` group is adjacent to other tool-like items
- THEN the `×N` group SHALL count as a single member of the surrounding burst
- AND the burst SHALL wrap the `×N` group alongside the other tool-like items

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

### Requirement: Hard-boundary termination

The system SHALL terminate a burst run at the first hard row — any non-transparent, non-tool-like row, including `user`, non-empty `assistant`, `interactiveUi`, `bashOutput`, and `inlineTerminal`. A hard row SHALL be emitted verbatim at the top level and SHALL NOT be absorbed into any burst. Leading transparent rows buffered ahead of a run that is never confirmed (a hard row follows instead) SHALL be flushed verbatim before the hard row and SHALL NOT cross the boundary into a later group.

#### Scenario: Non-empty assistant reply splits two bursts

- WHEN a run of tool calls is followed by a non-empty `assistant` reply and then more tool calls
- THEN the assistant reply SHALL remain a top-level row between two separate burst groups
- AND neither burst SHALL absorb the assistant reply

#### Scenario: Buffered transparents flush before a hard row

- WHEN transparent rows are buffered and the next non-transparent row is a hard row rather than a tool-like item
- THEN the buffered transparents SHALL be emitted verbatim in original order
- AND the hard row SHALL follow them at the top level

### Requirement: Bare semantic-group exception

The system SHALL leave a lone semantic `×N` group unwrapped (a bare group) when it is the sole member of its run AND every absorbed transparent (leading and trailing) is structural — `rawEvent`, `turnSeparator`, `commandFeedback`, or empty `assistant` — with no `thinking` present. In the bare case the leading transparents, the `×N` group, and the trailing transparents SHALL be emitted standalone in original order, avoiding a double frame. A lone `×N` group that absorbed any `thinking` row SHALL instead be wrapped in a burst so its reasoning folds inside.

#### Scenario: Lone group with only structural transparents stays bare

- WHEN a single `×N` group's absorbed transparents are all structural (e.g. `rawEvent`, `turnSeparator`) with no `thinking`
- THEN the `×N` group SHALL be emitted as a bare group, not wrapped in a burst
- AND its surrounding transparent rows SHALL be emitted standalone in original order

#### Scenario: Lone group with absorbed thinking wraps into a burst

- WHEN a single `×N` group absorbs a `thinking` row
- THEN it SHALL be wrapped in a burst group
- AND the `thinking` row SHALL fold inside that burst
