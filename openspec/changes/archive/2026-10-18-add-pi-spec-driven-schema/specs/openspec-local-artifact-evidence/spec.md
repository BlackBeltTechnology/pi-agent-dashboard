## MODIFIED Requirements

### Requirement: Design-artifact local evidence

The system SHALL treat the `design` artifact as satisfied locally when any one of three ordered, short-circuiting rules matches inside the change folder: (R1) a file matching `^design.*\.md$` exists, (R2) a `design/` subdirectory exists containing at least one `*.md` file, or (R3) `tasks.md` exists and contains at least one Markdown checkbox matching `^\s*-\s+\[[ xX]\]\s`.

The design evidence SHALL NOT be evaluated for changes whose `schemaName` is `pi-spec-driven`: that schema declares a skipped design explicitly (`design.md` containing `Not needed: <reason>`), so their `design` status SHALL be the CLI verdict. Every other schema keeps the rules.

#### Scenario: Split design files (R1)

- **WHEN** the change folder contains `design-rendering.md` and `design-state.md` but no single `design.md`
- **THEN** rule R1 matches because both names match `^design.*\.md$`
- **AND** the design evidence evaluates satisfied

#### Scenario: Design subdirectory (R2)

- **WHEN** the change folder has no `design*.md` file at its top level
- **AND** a `design/` subdirectory exists holding at least one `*.md` file
- **THEN** rule R2 matches
- **AND** the design evidence evaluates satisfied

#### Scenario: No-design change inferred from tasks (R3)

- **WHEN** the change has no `design*.md` file and no `design/` subdirectory with markdown
- **AND** `tasks.md` exists and contains at least one line like `- [ ]` or `- [x]`
- **THEN** rule R3 matches
- **AND** the design evidence evaluates satisfied

#### Scenario: Short-circuit ordering

- **WHEN** the design evidence is evaluated
- **THEN** rules are checked in order R1, then R2, then R3
- **AND** the first matching rule returns satisfied without evaluating later rules

#### Scenario: No design evidence present

- **WHEN** the change folder has no matching design file, no design subdirectory with markdown, and no `tasks.md` with a checkbox
- **THEN** the design evidence evaluates not satisfied

#### Scenario: Evidence ignored for the workflow schema

- **WHEN** a change on `pi-spec-driven` has no `design.md` but its `tasks.md` contains checkboxes
- **THEN** no rule SHALL be evaluated for `design`
- **AND** `design` SHALL keep the CLI-reported status

### Requirement: Promote-only reconciliation

The system SHALL only promote an artifact's status upward from `ready` to `done` based on local evidence, and SHALL NOT demote, downgrade, or otherwise change any artifact the CLI already reports. For the `design` artifact the reconciliation itself SHALL be skipped (evidence not evaluated) when the change's `schemaName` is `pi-spec-driven`.

#### Scenario: CLI already satisfied

- **WHEN** the CLI reports the `design` or `specs` artifact as `done`
- **THEN** the local-evidence override is not evaluated for that artifact
- **AND** the artifact remains `done`

#### Scenario: Evidence fills a gap

- **WHEN** the CLI reports the `design` or `specs` artifact as `ready`
- **AND** the corresponding local evidence evaluates satisfied
- **THEN** that artifact's status is promoted to `done`

#### Scenario: Neither CLI nor evidence satisfies

- **WHEN** the CLI reports the artifact as `ready`
- **AND** the local evidence evaluates not satisfied
- **THEN** the artifact's status remains `ready`

#### Scenario: Override is scoped to its own artifact

- **WHEN** the design override or specs override fires for a change
- **THEN** only that one artifact (`design` or `specs` respectively) is promoted
- **AND** no other artifact in the change is modified
