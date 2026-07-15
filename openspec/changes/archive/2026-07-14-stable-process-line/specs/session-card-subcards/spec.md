# session-card-subcards Specification (delta)

## MODIFIED Requirements

### Requirement: PROCESS subcard composition
The PROCESS subcard SHALL present its in-flight bash activity and background-process inventory through a single collapsible summary line of fixed height, so that starting or finishing a tool does not change the subcard's collapsed height. The subcard SHALL NOT render a variable stack of always-open rows whose count changes the card height.

The subcard's presence at idle SHALL be governed by the `reserveProcessLineAtIdle` display preference (effective value from `useDisplayPrefs(session.id)`).

#### Scenario: Collapsed height invariant across tool count
- **GIVEN** the PROCESS summary line is collapsed
- **WHEN** the number of in-flight bash tools changes between 0, 1, and 3
- **THEN** the collapsed subcard height SHALL remain unchanged

#### Scenario: Idle with reservation off hides the subcard
- **GIVEN** no in-flight bash tools and no background processes
- **AND** effective `reserveProcessLineAtIdle` is `false`
- **WHEN** the PROCESS subcard renders
- **THEN** it SHALL render nothing (returns null)

#### Scenario: Idle with reservation on shows one reserved line
- **GIVEN** no in-flight bash tools and no background processes
- **AND** effective `reserveProcessLineAtIdle` is `true`
- **WHEN** the PROCESS subcard renders
- **THEN** it SHALL render exactly one reserved summary line with an idle indicator

#### Scenario: Expanding reveals the full body
- **GIVEN** the collapsed summary line with one or more in-flight bash tools and/or background processes
- **WHEN** the user activates (clicks) the summary line
- **THEN** it SHALL expand in place to show every in-flight bash row followed by every background-process row
- **AND** the expand/collapse state SHALL persist per session via the existing process-drawer collapse persistence
