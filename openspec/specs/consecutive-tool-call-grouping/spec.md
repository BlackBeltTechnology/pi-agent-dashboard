# consecutive-tool-call-grouping Specification

## Purpose

Collapse consecutive tool-call retry loops in the chat timeline into a single ×N pill. When the same tool is invoked repeatedly with identical arguments (e.g. health-check polling issuing the same bash command many times), the timeline SHALL render one group instead of N separate rows. Narration rows (thinking, prose, separators) that sit between the repeated calls are treated as transparent: they do not break the run and are absorbed into the group for expanded rendering.

## Requirements

### Requirement: Grouping consecutive same-tool calls

The system SHALL scan the message list for runs of consecutive `toolResult` rows that share the same tool name and equal arguments, and collapse a qualifying run into a single group item.

#### Scenario: Same tool repeated enough times forms a group
- WHEN three or more consecutive `toolResult` rows have the same `toolName` and equal `args`
- THEN the run SHALL be replaced by one group item of `type: "group"`
- AND the group's `toolName` SHALL be the shared tool name
- AND the group's `messages` SHALL contain the grouped `toolResult` rows that drive the ×N count

#### Scenario: Run below the group threshold is not collapsed
- WHEN a run of matching consecutive `toolResult` rows contains fewer than three `toolResult` rows
- THEN no group item SHALL be produced
- AND every walked row SHALL be emitted verbatim in original order, including any intermediate transparent rows

#### Scenario: A single tool call is never grouped
- WHEN a `toolResult` row is not followed by two or more further matching `toolResult` rows
- THEN that row SHALL be emitted as a standalone `toolResult` item

### Requirement: Argument equality for grouping

The system SHALL only extend a run to a later `toolResult` when its arguments are equal to the first row's arguments.

#### Scenario: Identical arguments extend the run
- WHEN a later `toolResult` has the same `toolName` and its `args` serialize identically (JSON-stringified equality) to the group's first row
- THEN it SHALL be included in the group

#### Scenario: Both rows have no arguments
- WHEN neither the group's first row nor a later matching-name `toolResult` has `args`
- THEN their arguments SHALL be treated as equal and the later row SHALL be included

#### Scenario: Differing arguments end the run
- WHEN a later `toolResult` has the same `toolName` but its `args` do not serialize identically (or exactly one side has `args`)
- THEN the run SHALL end before that row

### Requirement: Transparent rows do not break a run

The system SHALL treat rows with role `assistant`, `thinking`, `turnSeparator`, `rawEvent`, or `commandFeedback` as transparent while scanning for the next groupable `toolResult`: such rows are skipped and do not terminate the run.

#### Scenario: Narration between identical calls is absorbed
- WHEN transparent rows appear between two matching `toolResult` rows in an otherwise-qualifying run
- THEN those rows SHALL NOT end the run
- AND when a group forms, its `rendered` slice SHALL include the absorbed transparent rows in original order alongside the grouped tool calls
- AND the absorbed transparent rows SHALL render only inside the expanded group view, not as standalone collapsed-timeline rows

#### Scenario: Trailing transparent rows after the last grouped call are not consumed
- WHEN transparent rows follow the final grouped `toolResult`
- THEN the group SHALL end at the last consumed `toolResult`
- AND the trailing transparent rows SHALL remain for the next scan iteration rather than being absorbed into the group

### Requirement: Boundary conditions that end a group

The system SHALL end a run when it encounters a non-transparent row that is not a matching, completed `toolResult`.

#### Scenario: A different tool ends the run
- WHEN the next non-transparent row is a `toolResult` whose `toolName` differs from the group's first row
- THEN the run SHALL end before that row

#### Scenario: A hard non-transparent row ends the run
- WHEN the next non-transparent row is neither a `toolResult` nor a transparent-role row (for example `user`, `interactiveUi`, or `bashOutput`)
- THEN the run SHALL end before that row

#### Scenario: A running tool call is never absorbed
- WHEN the run-starting `toolResult` has `toolStatus` of `running`
- THEN it SHALL be emitted as a standalone live row and never collapsed
- AND WHEN a later matching `toolResult` has `toolStatus` of `running`
- THEN the run SHALL end before that running row so it renders as a live card
