# roles-settings-ui Specification Delta

## ADDED Requirements

### Requirement: The naming model is configurable, and discoverable from the toggle

The model that names sessions SHALL be configurable through the `naming` role in the Roles
panel, and the settings surface carrying the "auto-name sessions" toggle SHALL point the
operator there, so the naming model is discoverable at the point of use.

The `naming` row SHALL be driven by the SAME roles handlers as every other role
(`roles:get-all` for read, `roles:set` for assignment). It SHALL NOT introduce a separate
preference, a separate persisted field, or a separate source of truth for the naming model.

When `naming` is unassigned, the surface SHALL indicate that the `fast` role is used as the
fallback, so an operator does not read "unassigned" as "auto-naming is off".

Role reads and writes travel over a connected pi session's bridge. When no session is
connected, the row SHALL degrade to a clearly unavailable presentation rather than appear
editable-but-broken.

A preset load replaces the roles map wholesale and MAY drop a `naming` assignment. The row
SHALL reflect the post-preset assignment, so a naming model silently reverted to the `fast`
fallback is visible rather than hidden.

The `naming` role MAY be absent from the effective role schema entirely when a removal
marker is in effect. The surface SHALL handle that REMOVED state distinctly from the
unassigned state, rather than rendering a slot the Roles panel does not list.

> **Placement note.** An earlier draft required this row rendered INLINE beneath the
> auto-name toggle. That is not achievable: since `plugin-settings-pages`, `claim.tab` is
> inert and every `settings-section` claim renders on `/settings/plugins/<id>`
> (`SettingsPanel.tsx:298-301`), while `usePluginConfig` throws outside a plugin slot
> (`plugin-context.tsx:212-220`). Keeping the shared roles handlers was judged worth more
> than the placement, so the row lives in the Roles panel and the toggle carries a pointer.

#### Scenario: The naming row reflects the roles map

- **GIVEN** `roles.naming` is assigned a model
- **WHEN** the Roles panel renders
- **THEN** the `naming` row SHALL show that assigned model

#### Scenario: Assignment persists via roles

- **WHEN** the user assigns a model in the `naming` row
- **THEN** the assignment SHALL be written through `roles:set`
- **AND** no new preference field SHALL be written

#### Scenario: The auto-name toggle points to the naming model

- **WHEN** the settings surface carrying the auto-name toggle renders
- **THEN** it SHALL name where the naming model is configured
- **AND** SHALL indicate the `fast` fallback that applies when `naming` is unassigned

#### Scenario: Unassigned naming shows the fallback

- **GIVEN** `roles.naming` has no assigned model
- **WHEN** the Roles panel renders
- **THEN** the `naming` row SHALL render as an assignable slot rather than being absent
- **AND** the `fast` fallback SHALL be indicated on the auto-name settings surface, at the point of use — the Roles grid renders every role uniformly and carries no per-role fallback text

#### Scenario: A removed naming role is presented distinctly

- **GIVEN** a removal marker is in effect for the `naming` role
- **WHEN** the Roles panel renders
- **THEN** the removed state SHALL be presented
- **AND** an assignable `naming` slot SHALL NOT be rendered

#### Scenario: No connected session degrades the row

- **GIVEN** no pi session is connected
- **WHEN** the Roles panel renders
- **THEN** the `naming` row SHALL present as unavailable
- **AND** SHALL NOT present as an editable control that silently fails on write

#### Scenario: A preset load is reflected

- **GIVEN** `roles.naming` is assigned a model
- **WHEN** the operator loads a preset whose roles map has no `naming` entry
- **THEN** the `naming` row SHALL show as unassigned with the `fast` fallback indication
