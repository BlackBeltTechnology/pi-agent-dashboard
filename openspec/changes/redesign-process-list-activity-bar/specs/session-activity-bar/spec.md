# session-activity-bar Specification

## Purpose

Surface the agent's in-flight `bash` tool calls as a prominent, abortable row at the top of the session card's PROCESS subcard. Driven by the client-side event reducer's unresolved-toolCall set. Replaces the conflated semantics of today's PGID-only ProcessList ✕ button with a dedicated "stop what the agent is doing" verb.

## ADDED Requirements

### Requirement: Activity bar renders unresolved bash toolCalls
The session activity bar SHALL render one row per unresolved `bash` toolCall associated with the session, sourced from the client-side event reducer.

#### Scenario: No bash tools in flight
- **GIVEN** the event reducer reports zero unresolved `bash` toolCalls for the session
- **WHEN** the activity bar component renders
- **THEN** the component SHALL render nothing (returns null)

#### Scenario: One bash tool in flight
- **GIVEN** the event reducer reports exactly one unresolved `bash` toolCall with command `"npm test"` started 12s ago
- **WHEN** the activity bar component renders
- **THEN** the component SHALL render one row containing the play indicator, the command string `"npm test"`, the elapsed time `12s`, and a stop button

#### Scenario: Non-bash tools are excluded
- **GIVEN** the event reducer reports unresolved `read`, `write`, and `interactiveUi` toolCalls but zero `bash` toolCalls
- **WHEN** the activity bar component renders
- **THEN** the component SHALL render nothing

### Requirement: Stop button invokes the abort path, not PGID kill
The activity bar's stop button SHALL invoke `abortToolCall(toolCallId)` (or the session-level abort fallback when no per-toolCall abort exists), and SHALL NOT invoke any PGID kill path.

#### Scenario: Stop click aborts the tool call
- **GIVEN** an activity bar row for toolCall with id `"tc-abc"`
- **WHEN** the user clicks the stop button on that row
- **THEN** the component SHALL invoke its `onAbort` callback with argument `"tc-abc"`
- **AND** the component SHALL NOT invoke any `killProcess` / `force_kill` / PGID-targeted action

### Requirement: Multi-bash rendering with overflow cap
When multiple `bash` toolCalls are in flight, the activity bar SHALL render up to N visible rows (N decided in design.md Decision 6, default N=2), then collapse the remainder into a single overflow chip showing `+M more` where M is the hidden count.

#### Scenario: Below the cap
- **GIVEN** the event reducer reports 2 unresolved `bash` toolCalls and the cap N=2
- **WHEN** the activity bar renders
- **THEN** the component SHALL render 2 rows and no overflow chip

#### Scenario: At the cap with overflow
- **GIVEN** the event reducer reports 5 unresolved `bash` toolCalls and the cap N=2
- **WHEN** the activity bar renders
- **THEN** the component SHALL render the 2 most-recently-started rows
- **AND** the component SHALL render one overflow chip with text `+3 more`

### Requirement: Stop button tooltip distinguishes verb
The stop button SHALL expose a tooltip distinguishing its action from the background drawer's force-kill.

#### Scenario: Stop button tooltip
- **GIVEN** an activity bar row
- **WHEN** the user hovers the stop button
- **THEN** the tooltip SHALL contain text indicating the action stops the tool while letting the agent continue (literal copy in design.md: `"Stop this tool (lets the agent continue)"`)

### Requirement: Accessibility — activity bar is live status
The activity bar container SHALL expose `role="status"` and `aria-live="polite"` so assistive tech announces when a bash tool starts or stops.

#### Scenario: Screen reader announces start
- **GIVEN** the activity bar is empty
- **WHEN** a new `bash` toolCall starts and the component re-renders with one row
- **THEN** the container SHALL have `role="status"` and `aria-live="polite"`

### Requirement: Elapsed time formatting matches BackgroundProcessesDrawer
The activity bar SHALL format elapsed times using the same `formatElapsed(ms)` helper as the BackgroundProcessesDrawer to keep the two surfaces visually consistent.

#### Scenario: Sub-minute elapsed
- **GIVEN** a toolCall started 47s ago
- **WHEN** the row renders
- **THEN** the elapsed cell SHALL contain text `"47s"`

#### Scenario: Minute-plus elapsed
- **GIVEN** a toolCall started 2m 14s ago
- **WHEN** the row renders
- **THEN** the elapsed cell SHALL contain text `"2m 14s"`
