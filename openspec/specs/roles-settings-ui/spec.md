# roles-settings-ui Specification

## Purpose
Provide a dashboard settings-panel section for editing the global role→model bindings that pi-flows consumes. Users assign models to built-in and custom roles, manage named presets, and defer persistence through the host Settings panel's unified Save/Reload contract.
## Requirements
### Requirement: Settings-section registration
The roles plugin SHALL register its editing UI as a `settings-section` contribution under the General settings tab so the dashboard host renders it inside the global settings panel.

#### Scenario: Plugin claims the settings-section slot
- **WHEN** the dashboard loads plugin manifests
- **THEN** the `roles` plugin manifest declares a claim with `slot: "settings-section"`, `component: "BuiltInRolesSettings"`, and `tab: "general"`
- **AND** the barrel entry exports `BuiltInRolesSettings` under a name matching the manifest `component` field

### Requirement: Global role→model assignment
The section SHALL list every role from the plugin config and let the user assign a model to each role via the shared model-selector primitive.

#### Scenario: Roles rendered from plugin config
- **WHEN** the plugin config supplies a `roles` map, `models` list, and `builtinRoleNames`
- **THEN** each role renders as a pill showing `@<role>` and its currently effective model
- **AND** roles present in `builtinRoleNames` render under a "Built-in" group and all other roles render under a "Custom" group
- **AND** when `builtinRoleNames` is empty every role renders in one flat grid

#### Scenario: Assigning a model to a role
- **WHEN** the user clicks a role pill and selects a model in the opened model-selector
- **THEN** the picker emits the full `"<provider>/<id>"` label and the pill displays that value with an unsaved (dirty) marker
- **AND** no role-mutation message is sent to the server at selection time

#### Scenario: Unassigned role affordance
- **WHEN** a role has no assigned model
- **THEN** the pill shows an "+ Add model" affordance instead of a model label

#### Scenario: Legacy bare-id value display
- **WHEN** a persisted role value has no `/` separator and a matching model id exists in the `models` list
- **THEN** the pill displays the resolved `"<provider>/<id>"` label without mutating the stored value

### Requirement: Deferred persistence via host Save/Reload
The section SHALL stage role picks locally and flush or discard them only through the host Settings panel's unified Save and Reload actions, never on individual selection.

#### Scenario: Registering with the host draft source
- **WHEN** the section mounts
- **THEN** it registers a settings draft source identified as `plugin:roles` on the `general` page exposing its dirty state, a commit handler, and a reset handler

#### Scenario: Committing pending role picks
- **WHEN** the host Save is invoked and pending role changes exist
- **THEN** the section dispatches one `role_set` message per dirty role, each carrying the target role, provider, and model id
- **AND** the local pending state is cleared

#### Scenario: Round-trip-clean pick
- **WHEN** a pending pick equals the persisted server value for that role
- **THEN** the role is not counted as dirty and its pending entry is removed

#### Scenario: Reconciling server acknowledgements and external edits
- **WHEN** a fresh `roles` map arrives whose value for a role equals a pending entry
- **THEN** that pending entry is auto-cleared while conflicting pending entries are preserved

#### Scenario: Discarding pending changes
- **WHEN** the host Reload/reset is invoked
- **THEN** all pending role picks are discarded and pills revert to the persisted server state

#### Scenario: No live session to persist
- **WHEN** commit runs and no non-ended pi session exists to route messages through
- **THEN** commit throws a "no live pi session" error and no `role_set` is dispatched

### Requirement: Custom role management
The section SHALL let the user add named custom roles (validated) and remove them, with removal applied immediately and confirmed.

#### Scenario: Adding a custom role
- **WHEN** the user activates "+ Add custom role", types a name, and confirms
- **THEN** the name is validated with the shared role-name validation against the union of built-in, persisted, and pending role names
- **AND** on a valid name the model-selector opens scoped to the new role name
- **AND** on an invalid name a validation-reason hint is shown and confirmation is blocked

#### Scenario: Removing a custom role
- **WHEN** the user clicks the × on a custom role pill and confirms the prompt
- **THEN** a `role_remove` message is dispatched for that role and any staged pending pick for it is dropped
- **AND** built-in role pills expose no remove control

### Requirement: Preset create, load, and delete
The section SHALL let the user snapshot the current role assignments as a named preset, load an existing preset, and delete a preset.

#### Scenario: Saving current assignments as a preset
- **WHEN** the user enters a preset name and confirms "+ Save current as preset"
- **THEN** any unsaved role edits are flushed first via `role_set`, then a `role_preset_save` message is dispatched with the preset name

#### Scenario: Loading a preset
- **WHEN** the user clicks a preset chip
- **THEN** if unsaved edits exist the user is prompted to discard them, and on confirmation pending is cleared
- **AND** a `role_preset_load` message is dispatched with the preset name

#### Scenario: Deleting a preset
- **WHEN** the user clicks the × on a preset chip
- **THEN** a `role_preset_delete` message is dispatched with the preset name

#### Scenario: Active preset indication
- **WHEN** the config `activePreset` matches a preset name
- **THEN** that preset chip renders in the active/selected state

### Requirement: Setup and back-compat states
The section SHALL surface a setup prompt when no role is assigned and remain functional against older bridges that omit the built-in role set.

#### Scenario: No roles configured
- **WHEN** no role in the config has an assigned model
- **THEN** a setup banner prompts the user to assign a model to a role

#### Scenario: Older bridge without built-in role names
- **WHEN** the config omits `builtinRoleNames` (empty)
- **THEN** all roles render as a single flat group and no pill shows a remove control

### Requirement: Thinking level paired with the role model

The role model-picker SHALL render a thinking-level control beside the
model-selector primitive, using the shared `ui:thinking-level-selector`
primitive. The control's selectable levels SHALL be derived from the picked
model's `supportedThinkingLevels` as supplied by the plugin config `models`
list; when the picked model advertises no level set, the primitive's fallback
set SHALL be used.

The chosen level SHALL be persisted as a `:<level>` suffix on the role's
existing ref string (`"<provider>/<id>:<level>"`) — the roles section SHALL NOT
introduce a second field or a parallel level map. Choosing the no-override
option SHALL strip the suffix, leaving a bare `"<provider>/<id>"` ref.

A ref that already carries a suffix SHALL display its base model in the model
selector and its level in the thinking control. Changing the model SHALL
preserve the chosen level when the newly picked model supports it, and SHALL
drop the suffix when it does not.

Level picks SHALL follow the same deferred-persistence contract as model picks:
staged in `pending` and flushed only by the host Settings panel's Save action,
never dispatched at selection time.

#### Scenario: Level control renders beside the model picker

- **WHEN** the user opens the model-picker for a role
- **THEN** a thinking-level control SHALL render beside the model selector
- **AND** its selectable levels SHALL be limited to the picked model's `supportedThinkingLevels`

#### Scenario: Level encoded as a ref suffix

- **WHEN** the user picks model `anthropic/claude-sonnet-4-5` and level `high` for `@planning`
- **THEN** the staged value for `@planning` SHALL be `"anthropic/claude-sonnet-4-5:high"`
- **AND** no separate level field SHALL be written

#### Scenario: No-override strips the suffix

- **WHEN** a role's staged ref is `"anthropic/claude-sonnet-4-5:high"` and the user selects the no-override option
- **THEN** the staged value SHALL become `"anthropic/claude-sonnet-4-5"` with no suffix

#### Scenario: Existing suffixed ref splits for display

- **WHEN** a persisted role value is `"anthropic/claude-sonnet-4-5:high"`
- **THEN** the model selector SHALL show `anthropic/claude-sonnet-4-5` as current
- **AND** the thinking control SHALL show `high` as current
- **AND** the pill SHALL NOT be marked dirty by rendering alone

#### Scenario: Level dropped when the new model does not support it

- **WHEN** a role holds `"<provider>/<a>:xhigh"` and the user picks model `<provider>/<b>` whose `supportedThinkingLevels` omits `xhigh`
- **THEN** the staged value SHALL be `"<provider>/<b>"` with no suffix

#### Scenario: Level pick is deferred like a model pick

- **WHEN** the user changes only the thinking level for a role
- **THEN** the pill SHALL show the unsaved (dirty) marker
- **AND** no role-mutation message SHALL be sent to the server until the host Save action runs

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
- **THEN** it SHALL indicate that the `fast` role is used as the fallback

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

