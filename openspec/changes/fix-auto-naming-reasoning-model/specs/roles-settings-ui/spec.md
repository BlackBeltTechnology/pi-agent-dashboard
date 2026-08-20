# roles-settings-ui Specification Delta

## ADDED Requirements

### Requirement: Inline naming-model row beside the auto-name toggle

The settings surface that carries the "auto-name sessions" toggle SHALL additionally render the single `naming` role row directly beneath that toggle, so the model that names sessions is configurable at the point of use.

The inline row SHALL be driven by the SAME roles handlers as the Roles panel (`roles:get-all` for read, `roles:set` for assignment). It SHALL NOT introduce a separate preference, a separate persisted field, or a separate source of truth for the naming model.

The `naming` role SHALL remain listed in the Roles panel; the inline row is an additional view of the same assignment, and an edit in either place SHALL be reflected in the other.

When `naming` is unassigned, the inline row SHALL indicate that the `fast` role is used as the fallback.

Role reads and writes travel over a connected pi session's bridge. When no session is connected, the inline row SHALL degrade to a clearly unavailable presentation rather than appear editable-but-broken.

A preset load replaces the roles map wholesale and MAY drop a `naming` assignment. The inline row SHALL reflect the post-preset assignment, so a naming model silently reverted to the `fast` fallback is visible rather than hidden.

The `naming` role MAY be absent from the effective role schema entirely when a removal marker is in effect. The inline row SHALL handle that REMOVED state distinctly from the unassigned state, rather than rendering a slot the Roles panel does not list.

#### Scenario: Inline row reflects the roles map

- **GIVEN** `roles.naming` is assigned a model
- **WHEN** the settings surface with the auto-name toggle renders
- **THEN** a `naming` model row SHALL appear beneath the toggle showing that assigned model

#### Scenario: Assignment from the inline row persists via roles

- **WHEN** the user assigns a model in the inline `naming` row
- **THEN** the assignment SHALL be written through `roles:set`
- **AND** the Roles panel SHALL show the same assignment
- **AND** no new preference field SHALL be written

#### Scenario: Unassigned naming shows the fallback

- **GIVEN** `roles.naming` has no assigned model
- **WHEN** the inline row renders
- **THEN** it SHALL indicate that the `fast` role is used as the fallback

#### Scenario: A removed naming role is presented distinctly

- **GIVEN** a removal marker is in effect for the `naming` role
- **WHEN** the settings surface renders
- **THEN** the inline row SHALL present the removed state
- **AND** SHALL NOT present an assignable slot that the Roles panel does not list

#### Scenario: No connected session degrades the row

- **GIVEN** no pi session is connected
- **WHEN** the settings surface renders
- **THEN** the inline `naming` row SHALL present as unavailable
- **AND** SHALL NOT present as an editable control that silently fails on write

#### Scenario: A preset load is reflected in the inline row

- **GIVEN** `roles.naming` is assigned a model
- **WHEN** the operator loads a preset whose roles map has no `naming` entry
- **THEN** the inline row SHALL show `naming` as unassigned with the `fast` fallback indication

#### Scenario: Toggle disabled hides nothing structurally

- **GIVEN** the auto-name toggle is off
- **WHEN** the settings surface renders
- **THEN** the inline `naming` row MAY be shown in a disabled/inactive presentation
- **AND** the underlying role assignment SHALL be unchanged
