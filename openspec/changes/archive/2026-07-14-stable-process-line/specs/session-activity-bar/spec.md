# session-activity-bar Specification (delta)

## MODIFIED Requirements

### Requirement: Activity bar renders unresolved bash toolCalls
The session activity bar SHALL contribute the agent's in-flight `bash` tool calls to the PROCESS subcard's single collapsible summary line rather than rendering as an independent always-open stack of rows. When collapsed, the running bash tools SHALL be represented by the primary running command and a running-count segment; the individual abortable rows SHALL appear in the expanded body.

#### Scenario: Collapsed line shows the primary running command
- **GIVEN** two unresolved `bash` toolCalls (`"npm run build"` newest, `"tsc --noEmit"`)
- **WHEN** the summary line renders collapsed
- **THEN** it SHALL show the newest command `"npm run build"` and a `2 running` count segment
- **AND** it SHALL NOT render two separate always-open rows

#### Scenario: Expanded body lists each abortable bash row
- **GIVEN** the collapsed summary line with two unresolved `bash` toolCalls
- **WHEN** the user expands the line
- **THEN** each `bash` toolCall SHALL render its own row with command, elapsed time, and a stop control
- **AND** activating a stop control SHALL invoke the session abort path (unchanged from prior behaviour)

#### Scenario: No bash in flight contributes no running segment
- **GIVEN** zero unresolved `bash` toolCalls
- **WHEN** the summary line renders
- **THEN** the running-count segment SHALL be absent
- **AND** the primary-command slot SHALL show the idle or background-process indicator instead
