## MODIFIED Requirements

### Requirement: Stop button invokes session turn abort, not PGID kill

Until a real per-tool cancellation protocol exists, the activity bar Stop button SHALL invoke the session turn-abort path and SHALL NOT claim to cancel only one tool. It SHALL NOT invoke a PGID kill or process-level Force Stop action.

#### Scenario: Activity Stop sends turn abort

- **GIVEN** the activity bar shows a running tool call with ID `tc-abc`
- **WHEN** the user activates its Stop control
- **THEN** the component SHALL invoke the session abort callback
- **AND** it SHALL NOT invoke `killProcess`, `force_kill`, or another PGID-targeted action

#### Scenario: Tool call ID is not represented as independently cancellable

- **GIVEN** the only available protocol operation is session-level `abort`
- **WHEN** the activity row renders its Stop control
- **THEN** the UI SHALL NOT state that only `tc-abc` will stop
- **AND** it SHALL NOT state that the agent will continue the same turn

### Requirement: Stop button tooltip describes current turn cancellation

The activity bar Stop control SHALL expose accessible copy that distinguishes turn cancellation from the background drawer's process-tree kill.

#### Scenario: Activity Stop tooltip

- **GIVEN** an activity bar row is running
- **WHEN** the user hovers or focuses its Stop control
- **THEN** the tooltip SHALL identify the action as stopping the current turn
- **AND** it SHALL NOT contain `lets the agent continue`

#### Scenario: Background process tooltip remains distinct

- **GIVEN** the background-process drawer renders a PGID kill control
- **WHEN** the user hovers or focuses that control
- **THEN** its tooltip SHALL identify process-tree termination rather than turn cancellation

## ADDED Requirements

### Requirement: Active turn cancellation remains directly reachable

While a tool call is active, the session card SHALL expose its turn-cancellation control without requiring the user to expand a default-collapsed static-details region.

#### Scenario: Static details are collapsed during active tool execution

- **GIVEN** the session card's static details are collapsed
- **AND** an unresolved tool call is active
- **WHEN** the session card renders
- **THEN** the active turn summary and Stop control SHALL remain visible and operable

#### Scenario: Session becomes idle with details collapsed

- **GIVEN** static details are collapsed and no tool call is active
- **WHEN** the session card renders
- **THEN** the card MAY hide the inactive process detail region
- **AND** no stale Stop control SHALL remain visible
