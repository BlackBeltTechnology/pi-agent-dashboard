## ADDED Requirements

### Requirement: CRUD classification step

The skill SHALL provide a CRUD classifier prompt that a subagent fills per screen batch from the
`crud-draft` output, choosing for each effect the entity it persists or reads (from the
candidates or `model.md`) and the op from the cited code, and SHALL accept a record only when
`check-crud` passes for it.

#### Scenario: Record accepted only when gated
- **WHEN** a classifier writes an entity that `model.md` does not define
- **THEN** `check-crud` refuses the record and the classifier fixes it before reporting
