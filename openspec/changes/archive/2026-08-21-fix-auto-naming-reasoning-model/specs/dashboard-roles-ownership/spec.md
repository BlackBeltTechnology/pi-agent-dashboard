# dashboard-roles-ownership Specification Delta

## MODIFIED Requirements

### Requirement: pi-agent-dashboard SHALL define a canonical default role-name set and overlay it at read time

The dashboard SHALL own a canonical default role-name set `DEFAULT_ROLE_NAMES = ["planning", "coding", "compact", "fast", "vision", "research", "naming"]`, defined in the dashboard (not read from pi-flows, which the dashboard no longer depends on for role ownership).

The `naming` role names the model used for automatic session topic-naming. It is a default NAME only: unassigned, the auto-namer falls back to the `fast` role, so adding this name SHALL NOT change resolution for any existing install.

The default set SHALL contribute role NAMES only; it SHALL NOT assign any model. A default role with no assigned model is "unconfigured". The dashboard SHALL overlay the effective role-name schema onto the assigned-roles map at READ time (in the `roles:get-all` response) so the Roles UI is never an empty dead end. Assigned values SHALL win over defaults; non-default assigned roles SHALL be preserved.

The role-name schema SHALL be USER-EDITABLE. `DEFAULT_ROLE_NAMES` seeds the schema for display but is NOT immutable: a user (or the `update_roles` tool) MAY add a role name (implicitly, by assigning a model to a new name) and MAY remove any role name — including a default. Removal is a purge (see the removal requirement below); once removed, a default name SHALL NOT be re-injected by the read-time overlay for that role while a removal marker is in effect. The dashboard SHALL NOT auto-write default role names to `providers.json`; a role reaches disk only when a model is assigned.

#### Scenario: Default role names available on a fresh install

- **GIVEN** `~/.pi/agent/providers.json` has no `roles` key (or an empty `roles` map) and no removal markers
- **WHEN** the Roles back-end reports the roles map (via `roles:get-all`)
- **THEN** the reported roles SHALL include every name in `DEFAULT_ROLE_NAMES`, including `naming`
- **AND** each default role with no assignment SHALL report an empty/unset model value
- **AND** `~/.pi/agent/providers.json` SHALL NOT be created or modified by the read

#### Scenario: Assigned roles win over defaults in the overlay

- **GIVEN** `roles` contains `{ fast: "anthropic/haiku", custom: "x/y" }`
- **WHEN** the Roles back-end reports the roles map (via `roles:get-all`)
- **THEN** the reported map SHALL contain `fast: "anthropic/haiku"` and `custom: "x/y"`
- **AND** SHALL also contain the remaining un-removed `DEFAULT_ROLE_NAMES` with empty/unset values

#### Scenario: A user-added role persists and is reported

- **GIVEN** a model has been assigned to a new role name `review`
- **WHEN** the Roles back-end reports the roles map
- **THEN** `review` SHALL appear in the reported map with its assigned model

#### Scenario: An unassigned naming role is inert

- **GIVEN** `roles` has no `naming` assignment
- **WHEN** the auto-namer resolves its model
- **THEN** resolution SHALL fall back to the `fast` role
- **AND** no write to `~/.pi/agent/providers.json` SHALL occur as a result
