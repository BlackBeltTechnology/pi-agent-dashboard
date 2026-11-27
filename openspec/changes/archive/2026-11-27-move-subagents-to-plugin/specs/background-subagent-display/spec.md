# Spec Delta

## ADDED Requirements

### Requirement: A subagent row SHALL show the producer's type and task even without its created frame

When a subagent's state is first built from a `subagent_started` frame, the type SHALL be read from `details.subagentType`, the task from `details.description`, and the name from `details.displayName`, before any top-level field. A row SHALL NOT show the literal `unknown` while any of these is present. A later `subagent_created` SHALL NOT overwrite a type or task already read.

#### Scenario: Started frame only
- **GIVEN** no `subagent_created` for agent a1 reached the client
- **WHEN** `subagent_started { id: "a1", details: { subagentType: "batch-applier-b", description: "Apply nav-waits-in-rules", displayName: "batch-applier-b", status: "running" } }` arrives
- **THEN** the dock row SHALL read `batch-applier-b`, task `Apply nav-waits-in-rules`, meta `batch-applier-b · N steps`

#### Scenario: Neither frame carries a type
- **WHEN** a started frame with no `details.subagentType` and no top-level `type` arrives for an agent with no prior state
- **THEN** the row SHALL show the subagent's name if present, and otherwise the short id, never `unknown`

### Requirement: A truncated terminal frame SHALL still end the row

When a `subagent_completed` or `subagent_failed` arrives as a truncation placeholder carrying the agent id and status, the subagent SHALL become terminal with that status, its row SHALL leave the Processes lane, and its view SHALL say the final result was too large to keep.

#### Scenario: Over-size completion
- **GIVEN** background subagent a1 is running
- **WHEN** `subagent_completed { __truncated: true, id: "a1", details: { status: "completed" } }` arrives
- **THEN** a1 SHALL be `completed`, leave the Processes lane, and its view SHALL show the result-too-large note
