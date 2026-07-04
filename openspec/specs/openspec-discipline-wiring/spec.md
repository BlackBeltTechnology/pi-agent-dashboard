# openspec-discipline-wiring Specification

## Purpose
TBD - created by archiving change wire-discipline-skills-into-openspec. Update Purpose after archive.
## Requirements
### Requirement: AGENTS.md carries an implementation-phase discipline checkpoint table

AGENTS.md SHALL contain a task-signal → discipline-skill mapping for the implementation phase, positioned with the existing implementation gates, so the mapping is in always-on context during any implementation.

#### Scenario: Table exists next to the gates

- **WHEN** AGENTS.md is read
- **THEN** a `### Discipline-skill checkpoints (implementation phase)` subsection exists
- **AND** it sits adjacent to the Code-review and Code-quality gate subsections
- **AND** it maps observable task signals to the `eng-disciplines` skills

#### Scenario: Table names the situational disciplines

- **WHEN** the checkpoint table is read
- **THEN** it includes rows for `security-hardening`, `performance-optimization`, `observability-instrumentation`, `doubt-driven-review`, and `code-simplification`
- **AND** it includes `systematic-debugging` and `node-inspect-debugger` once `add-debugging-skills` has landed (or marks them pending that change)
- **AND** it states that the `code-review` and `code-quality` end gates are unchanged

### Requirement: Proposals declare their applicable discipline skills

AGENTS.md SHALL define a proposal-authoring convention that carries discipline-skill hints into the openspec implement loop via the proposal artifact, without modifying any openspec skill.

#### Scenario: Convention is documented under OpenSpec Conventions

- **WHEN** the `## OpenSpec Conventions` section of AGENTS.md is read
- **THEN** it instructs authors to add a `## Discipline Skills` line to `proposal.md` naming applicable `eng-disciplines` skills
- **AND** it maps skill selection to the checkpoint table
- **AND** it permits omission only when no discipline applies

#### Scenario: No openspec skill is modified

- **WHEN** the change's diff is inspected
- **THEN** no file under `.pi/skills/openspec-*` or `.pi/skills/implement` is modified
- **AND** the only modified file is `AGENTS.md`
- **AND** no code and no dependency is added

### Requirement: The convention is advisory, not gating

A missing `## Discipline Skills` line SHALL NOT block any build, gate, or commit.

#### Scenario: Absence does not fail a gate

- **WHEN** a proposal omits the `## Discipline Skills` line
- **THEN** no lint, CI job, or commit gate fails on that basis
- **AND** the posture matches the warn-and-continue behavior of the existing code-review gate

