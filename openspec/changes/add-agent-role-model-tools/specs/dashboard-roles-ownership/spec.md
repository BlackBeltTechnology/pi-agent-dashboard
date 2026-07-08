## MODIFIED Requirements

### Requirement: pi-agent-dashboard SHALL define a canonical default role-name set and overlay it at read time

The dashboard SHALL own a canonical default role-name set `DEFAULT_ROLE_NAMES = ["planning", "coding", "compact", "fast", "vision", "research"]`, defined in the dashboard (not read from pi-flows, which the dashboard no longer depends on for role ownership).

The default set SHALL contribute role NAMES only; it SHALL NOT assign any model. A default role with no assigned model is "unconfigured". The dashboard SHALL overlay the effective role-name schema onto the assigned-roles map at READ time (in the `flow:role-get-all` response) so the Roles UI is never an empty dead end. Assigned values SHALL win over defaults; non-default assigned roles SHALL be preserved.

The role-name schema SHALL be USER-EDITABLE. `DEFAULT_ROLE_NAMES` seeds the schema for display but is NOT immutable: a user (or the `update_roles` tool) MAY add a role name (implicitly, by assigning a model to a new name) and MAY remove any role name — including a default. Removal is a purge (see the removal requirement below); once removed, a default name SHALL NOT be re-injected by the read-time overlay for that role while a removal marker is in effect. The dashboard SHALL NOT auto-write default role names to `providers.json`; a role reaches disk only when a model is assigned.

#### Scenario: Default role names available on a fresh install

- **GIVEN** `~/.pi/agent/providers.json` has no `roles` key (or an empty `roles` map) and no removal markers
- **WHEN** the Roles back-end reports the roles map (via `flow:role-get-all`)
- **THEN** the reported roles SHALL include every name in `DEFAULT_ROLE_NAMES`
- **AND** each default role with no assignment SHALL report an empty/unset model value
- **AND** `~/.pi/agent/providers.json` SHALL NOT be created or modified by the read

#### Scenario: Assigned roles win over defaults in the overlay

- **GIVEN** `roles` contains `{ fast: "anthropic/haiku", custom: "x/y" }`
- **WHEN** the Roles back-end reports the roles map (via `flow:role-get-all`)
- **THEN** the reported map SHALL contain `fast: "anthropic/haiku"` and `custom: "x/y"`
- **AND** SHALL also contain the remaining un-removed `DEFAULT_ROLE_NAMES` with empty/unset values

#### Scenario: A user-added role persists and is reported

- **GIVEN** a model has been assigned to a new role name `review`
- **WHEN** the Roles back-end reports the roles map
- **THEN** `review` SHALL appear in the reported map with its assigned model

## ADDED Requirements

### Requirement: A new role SHALL surface as an empty slot across every preset

Because role names are resolution targets that agent configs and flows depend on, the role-name schema SHALL be shared across presets rather than per-preset. When a role name is added to the schema, it SHALL surface in every preset's editable view as an empty (unbound) slot until a model is assigned to it in that preset. Resolution of an unbound role SHALL follow the existing "not configured yet" path (no hard failure).

#### Scenario: Added role appears empty in all presets

- **GIVEN** presets `cheap` and `premium` exist, neither binding `review`
- **WHEN** `review` is added to the role-name schema
- **THEN** the editable view of both `cheap` and `premium` SHALL show `review` as an empty slot
- **AND** resolving `@review` under either preset SHALL report the structured "not configured yet" reason

### Requirement: Removing a role SHALL purge it from every preset

`remove_role` SHALL delete the role from the role-name schema, from the active roles map, and from every preset's roles map, in a single atomic write. Removal SHALL be confirmed by the user (via the `update_roles` tool's `ask_user` gate) before the write. Orphaned bindings SHALL NOT be left behind in any preset.

#### Scenario: Removal clears the binding everywhere

- **GIVEN** `vision` is bound in the active map and in presets `cheap` and `premium`
- **WHEN** `vision` is removed (with confirmation)
- **THEN** `vision` SHALL be absent from the schema, the active map, and both presets
- **AND** unrelated top-level keys (`providers`, `autonomousMode`) SHALL be preserved

### Requirement: `role:resolve-model` SHALL become a deprecated alias over the shared resolve path

To consolidate resolution onto `model:resolve`, the `role:resolve-model` listener SHALL be retained for ONE release as a deprecated alias whose `@role`→literal lookup delegates to the same shared `lookupRole` accessor used by `model:resolve` and the `flow:role-*` handlers. Its observable contract (`probe.resolved`, `probe.available`, `probe.reason`) SHALL be preserved during the alias window. The listener SHALL be annotated `// DEPRECATED` naming `model:resolve` as the replacement and stating removal at the next major.

#### Scenario: Alias preserves the subagents contract during the deprecation window

- **GIVEN** `roles.fast` is `"anthropic/haiku"`
- **WHEN** an emitter calls `pi.events.emit("role:resolve-model", { ref: "@fast" })`
- **THEN** `probe.resolved` SHALL equal `"anthropic/haiku"` (via the shared `lookupRole` accessor)
- **AND** the behaviour SHALL be identical to the pre-consolidation handler

#### Scenario: Current subagents harness resolves via model:resolve (no migration needed)

- **GIVEN** the installed subagents harness already emits `model:resolve` and reads `probe.model`
- **WHEN** it resolves an agent definition's `model: "@fast"`
- **THEN** it SHALL obtain the resolved `Model` from `probe.model` (via the dashboard's `model:resolve` handler)
- **AND** the `role:resolve-model` alias SHALL exist only for legacy harness builds that predate the `model:resolve` emit
