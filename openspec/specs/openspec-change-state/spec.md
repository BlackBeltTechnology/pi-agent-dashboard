# openspec-change-state Specification

## Purpose

Defines the `ChangeState` enum and the pure `deriveChangeState` function, so every surface that displays an OpenSpec change's state derives it the same way from the same inputs.

## Requirements

### Requirement: ChangeState enum
The shared types SHALL export `ChangeState` as an erasable `as const` object together with a same-named union type, with the string values `PLANNING`, `READY`, `IMPLEMENTING`, `COMPLETE` representing the lifecycle stages of an OpenSpec change. A TypeScript `enum` SHALL NOT be used (see `native-ts-loader` "First-party TypeScript uses only erasable syntax"). `ChangeState.X` SHALL evaluate to the string `"X"`.

#### Scenario: Enum values
- **WHEN** `ChangeState` is imported from shared types
- **THEN** it SHALL have exactly four values: `PLANNING`, `READY`, `IMPLEMENTING`, `COMPLETE`
- **AND** each member SHALL equal its own name as a string (e.g. `ChangeState.READY === "READY"`)

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
