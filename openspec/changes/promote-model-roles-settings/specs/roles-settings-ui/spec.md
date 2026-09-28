## MODIFIED Requirements

### Requirement: Settings-section registration
The roles plugin SHALL register its editing UI as a `settings-section` contribution so the dashboard host renders it inside the global settings panel, and SHALL request promotion into the Models nav group under the user-facing name "Model roles" ("Roles" alone reads as access control next to Security/Access).

#### Scenario: Plugin claims the settings-section slot
- **WHEN** the dashboard loads plugin manifests
- **THEN** the `roles` plugin manifest declares a claim with `slot: "settings-section"`, `component: "BuiltInRolesSettings"`, `tab: "general"`, and `nav: { group: "models", label: "Model roles", description: "Pick which model answers each @role. Agents, flows and skills ask for a role, not a model — changing it here re-routes them everywhere." }`
- **AND** the barrel entry exports `BuiltInRolesSettings` under a name matching the manifest `component` field

#### Scenario: Roles appears as Model roles at the top of Settings
- **WHEN** the roles plugin is installed and enabled and the user opens `/settings`
- **THEN** the first nav group `Models` SHALL list `Model roles`
- **AND** selecting it SHALL open `/settings/plugins/roles` with the role editor under the compact chrome

### Requirement: Deferred persistence via host Save/Reload
The section SHALL stage role picks locally and flush or discard them only through the host Settings panel's unified Save and Reload actions, never on individual selection.

#### Scenario: Registering with the host draft source
- **WHEN** the section mounts
- **THEN** it registers a settings draft source identified as `plugin:roles` exposing its dirty state, a commit handler, and a reset handler
- **AND** the host SHALL file that source under the plugin page key `plugins/roles` (whatever page the section declares), so the dirty dot and Save Bar label follow the page's rail entry — `Models › Model roles` while promoted

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
