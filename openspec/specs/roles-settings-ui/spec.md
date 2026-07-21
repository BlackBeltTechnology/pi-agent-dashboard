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
