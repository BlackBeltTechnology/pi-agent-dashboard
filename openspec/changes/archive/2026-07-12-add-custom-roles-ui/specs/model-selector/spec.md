## ADDED Requirements

### Requirement: Roles UI SHALL let the user add a custom role (atomic name + model)

The `BuiltInRolesSettings` settings-section contribution SHALL provide an **＋ Add custom role** affordance. Activating it SHALL reveal an inline, `@`-prefixed role-name input with live validation via the shared `isValidRoleName(name, existingNames)` helper, where `existingNames` is the set of effective role names currently shown. The confirm control SHALL be disabled while the input is invalid, and an inline hint SHALL indicate why (see the validation requirement).

On a valid name being confirmed, the contribution SHALL open the shared `ui:model-selector` primitive scoped to the new name. Selecting a model SHALL stage the assignment in local `pending` state keyed by the new name (NOT dispatch immediately), exactly as an existing-role pick does. The new role SHALL therefore be created only when the unified Settings Save flushes `pending` as a `role_set` message; a custom role SHALL NOT reach disk from a name alone. Cancelling the input (Escape or the cancel control) before a model is selected SHALL add nothing.

#### Scenario: Adding a custom role stages, then Save persists

- **GIVEN** the Roles section is open and no role named `doubt-verifier-1` exists
- **WHEN** the user clicks **＋ Add custom role**, types `doubt-verifier-1`, confirms, and picks model `anthropic/claude-haiku-4-5`
- **THEN** a pill `@doubt-verifier-1` SHALL render in the Custom group with an unsaved (dirty) marker
- **AND** no `role_set` WebSocket message SHALL be dispatched yet
- **WHEN** the user triggers the unified Settings Save
- **THEN** exactly one `role_set` message SHALL be dispatched with `role = "doubt-verifier-1"` and `modelId = "anthropic/claude-haiku-4-5"`

#### Scenario: Cancelling the add flow persists nothing

- **GIVEN** the user clicked **＋ Add custom role** and typed a name
- **WHEN** the user presses Escape before selecting a model
- **THEN** no pill SHALL be added and `pending` SHALL be unchanged

### Requirement: Role names SHALL be validated inline against reserved characters and collisions

The contribution SHALL reject, before staging, any custom role name that fails `isValidRoleName`: empty/whitespace-only names, names containing `/`, whitespace, `@`, or `.`, names not matching `^[A-Za-z0-9][A-Za-z0-9_-]*$`, and names that collide with an existing effective role name (built-in or custom). An invalid name SHALL surface an inline error hint and SHALL NOT open the model picker.

#### Scenario: Reserved character is rejected inline

- **GIVEN** the add-custom-role input is open
- **WHEN** the user types `doubt/verifier`
- **THEN** an inline error hint SHALL show and the confirm control SHALL be disabled
- **AND** the model picker SHALL NOT open

#### Scenario: Duplicate of an existing role is rejected

- **GIVEN** a role named `fast` already exists (built-in)
- **WHEN** the user types `fast` in the add-custom-role input
- **THEN** the name SHALL be rejected as a collision and the confirm control SHALL be disabled

### Requirement: Roles UI SHALL group Built-in and Custom roles using `builtinRoleNames`

The contribution SHALL render two labelled groups — Built-in and Custom — classifying each role by membership in the `builtinRoleNames` array carried on the `roles_list` payload. A role whose name is in `builtinRoleNames` is Built-in; every other role is Custom. The rendered role set SHALL be the union of persisted role keys (`rolesMap`) and pending-only names (`pending`), deduped, so an in-flight custom role appears before Save. When `builtinRoleNames` is absent (older server), the contribution SHALL render all roles in a single flat group (back-compatible).

#### Scenario: A pending-only custom name renders in the Custom group

- **GIVEN** `builtinRoleNames` contains `planning, coding, compact, fast, vision, research`
- **AND** the user has staged a pick for a new name `doubt-verifier-x` not yet in `rolesMap`
- **THEN** `@doubt-verifier-x` SHALL render in the Custom group with a dirty marker
- **AND** `@planning` SHALL render in the Built-in group

### Requirement: Custom roles SHALL be removable; built-in roles SHALL NOT

Each Custom role pill SHALL expose a **×** remove control; Built-in role pills SHALL NOT. Activating **×** SHALL prompt for confirmation (`window.confirm`); on confirm the contribution SHALL dispatch a `role_remove` WebSocket message for that role and SHALL drop any `pending` entry for it; on cancel it SHALL do nothing. Removal SHALL take effect immediately (not staged through the Settings Save buffer), consistent with preset deletion.

#### Scenario: Removing a custom role dispatches role_remove

- **GIVEN** a custom role `@doubt-verifier-1` is shown with a **×** control
- **WHEN** the user clicks **×** and confirms
- **THEN** a `role_remove` message with `role = "doubt-verifier-1"` SHALL be dispatched
- **AND** any `pending["doubt-verifier-1"]` entry SHALL be cleared

#### Scenario: Built-in roles expose no removal control

- **GIVEN** the built-in role `@planning` is rendered
- **THEN** its pill SHALL NOT expose a **×** remove control
