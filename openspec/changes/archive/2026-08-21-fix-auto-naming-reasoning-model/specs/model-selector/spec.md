# model-selector Specification Delta

## MODIFIED Requirements

### Requirement: Roles UI SHALL group Built-in and Custom roles using `builtinRoleNames`

The contribution SHALL render two labelled groups — Built-in and Custom — classifying each role by membership in the `builtinRoleNames` array carried on the `roles_list` payload. A role whose name is in `builtinRoleNames` is Built-in; every other role is Custom. The rendered role set SHALL be the union of persisted role keys (`rolesMap`) and pending-only names (`pending`), deduped, so an in-flight custom role appears before Save. When `builtinRoleNames` is absent (older server), the contribution SHALL render all roles in a single flat group (back-compatible).

The Built-in set SHALL include the `naming` role, which selects the model used for automatic session topic-naming.

An install that already carries a USER-CREATED custom role named `naming` SHALL have that assignment preserved — the name is reclassified from Custom to Built-in and its assigned model continues to be used, now as the naming model. The reclassification SHALL NOT delete the assignment.

#### Scenario: A pending-only custom name renders in the Custom group

- **GIVEN** `builtinRoleNames` contains `planning, coding, compact, fast, vision, research, naming`
- **AND** the user has staged a pick for a new name `doubt-verifier-x` not yet in `rolesMap`
- **THEN** `@doubt-verifier-x` SHALL render in the Custom group with a dirty marker
- **AND** `@planning` SHALL render in the Built-in group

#### Scenario: The naming role renders as built-in

- **GIVEN** `builtinRoleNames` contains `naming`
- **WHEN** the Roles UI renders
- **THEN** `@naming` SHALL render in the Built-in group

#### Scenario: A pre-existing custom naming role keeps its assignment

- **GIVEN** an install whose `rolesMap` already contains a user-created role named `naming` with an assigned model
- **WHEN** the Roles UI renders after `naming` becomes a built-in name
- **THEN** the assigned model SHALL still be reported for `naming`
- **AND** `naming` SHALL render in the Built-in group
