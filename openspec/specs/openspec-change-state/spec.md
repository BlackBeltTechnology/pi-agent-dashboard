# openspec-change-state Specification

## Purpose

Defines the `ChangeState` enum and the pure `deriveChangeState` function, so every surface that displays an OpenSpec change's state derives it the same way from the same inputs.

## Requirements

### Requirement: ChangeState enum
The shared types SHALL export a `ChangeState` enum with values `PLANNING`, `READY`, `IMPLEMENTING`, `COMPLETE` representing the lifecycle stages of an OpenSpec change.

#### Scenario: Enum values
- **WHEN** the `ChangeState` enum is imported from shared types
- **THEN** it SHALL have exactly four values: `PLANNING`, `READY`, `IMPLEMENTING`, `COMPLETE`

### Requirement: deriveChangeState pure function
The shared types SHALL export a `deriveChangeState(change: OpenSpecChange): ChangeState` pure function that derives the lifecycle state from existing change data without side effects.

#### Scenario: No artifacts — PLANNING
- **WHEN** a change has zero artifacts
- **THEN** `deriveChangeState` SHALL return `PLANNING`

#### Scenario: Some artifacts not done — PLANNING
- **WHEN** a change has artifacts `[{status: "done"}, {status: "ready"}]`
- **THEN** `deriveChangeState` SHALL return `PLANNING`

#### Scenario: All artifacts done, status no-tasks — READY
- **WHEN** a change has all artifacts with `status: "done"` and `change.status === "no-tasks"`
- **THEN** `deriveChangeState` SHALL return `READY`

#### Scenario: All artifacts done, status in-progress — IMPLEMENTING
- **WHEN** a change has all artifacts with `status: "done"` and `change.status === "in-progress"`
- **THEN** `deriveChangeState` SHALL return `IMPLEMENTING`

#### Scenario: All artifacts done, status complete — COMPLETE
- **WHEN** a change has all artifacts with `status: "done"` and `change.status === "complete"`
- **THEN** `deriveChangeState` SHALL return `COMPLETE`
