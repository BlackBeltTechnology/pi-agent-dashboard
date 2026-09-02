## MODIFIED Requirements

### Requirement: The role-events back-end implementation SHALL live in its own module

The implementation of the five `flow:role-*` handlers SHALL live in a dedicated source file `packages/extension/src/role-manager.ts` (named to mirror pi-flows' soon-deleted file for diff symmetry during review). The module SHALL export an `activate(pi: ExtensionAPI)` function that registers all five handlers.

The dashboard's main bridge module (or `provider-register.ts`, whichever serves as the activation entry today) SHALL call this `activate` exactly once during extension startup.

This module SHALL remain the sole **writer of the role slice** of `~/.pi/agent/providers.json` — the `roles`, `rolePresets`, `activePreset`, `roleNames`, and `removedRoles` keys — and the sole owner of the `roles:*` handler registrations. This SHALL NOT be read as exclusive ownership of the whole file: other components legitimately write sibling keys, and they SHALL preserve the role slice when they do.

Reading is NOT exclusive: other dashboard components MAY read the role slice for read-only purposes.

Every component that reads the role slice SHALL normalize the parsed contents through a single shared normalizer rather than interpreting the raw file itself. The normalizer SHALL be pure — it SHALL accept already-parsed data and SHALL NOT perform filesystem access, so non-server consumers can import it. It SHALL be total: any input, including a missing, empty, or structurally malformed value, SHALL yield a well-formed role configuration rather than throwing.

Normalization SHALL discard role assignments whose value is not a non-empty string, SHALL trim surviving values, and SHALL discard preset entries that are not objects carrying a string `name` and an object `roles` map. Where two preset entries share a name, normalization SHALL retain the **first** such entry and discard the rest — matching the existing save path, which updates the first index matching a name.

Introducing the shared normalizer changes the reported presets for configurations whose stored preset entries are structurally invalid, because such entries were previously relayed uninspected. This is an intended correction, not a regression: an entry that is not an object with a `roles` map cannot be rendered or loaded by any consumer.

These two corrections — discarding structurally invalid preset entries, and refusing to reintroduce a removed-but-assigned role name — are the only reported-payload changes this capability permits. For every configuration whose preset entries are well-formed and whose removal markers do not collide with an assignment, the reported payload SHALL be unchanged.

The **pure** role-schema helpers — the canonical default role-name set, the read-time overlay, the effective role-name computation, and the model-reference/thinking-level split — SHALL likewise live alongside the normalizer in the shared package and be imported back, so that every role read surface derives its schema from one definition.

The read-time overlay SHALL exclude every role name for which a removal marker is in effect, **including a name that also carries an assignment**. An assignment SHALL NOT reintroduce a removed name. This is a correction: overlaying the effective names and then merging the assigned map wholesale reintroduces such a name, so a configuration holding both a removal marker and an assignment for the same role currently reports it.

#### Scenario: Single activate call

- **WHEN** the dashboard extension's top-level `activate(pi)` runs
- **THEN** `packages/extension/src/role-manager.ts::activate(pi)` SHALL be called exactly once
- **AND** that call SHALL register five `pi.events.on(…)` listeners (one per event name above)

#### Scenario: Relocating pure helpers preserves the event payload

- **GIVEN** the pure role-schema helpers have been moved to the shared package and imported back
- **WHEN** the Roles back-end reports the roles map via `roles:get-all`
- **THEN** the payload SHALL be identical to the payload produced before the move
- **AND** the `roles:*` handlers and every write to `providers.json` SHALL still be performed by `packages/extension/src/role-manager.ts`

#### Scenario: A second reader does not become a second writer

- **GIVEN** another dashboard component reads the role slice of `providers.json`
- **WHEN** it serves that data
- **THEN** it SHALL normalize through the shared normalizer
- **AND** it SHALL NOT write to `providers.json`

#### Scenario: A removal marker beats an assignment for the same role

- **GIVEN** a removal marker is in effect for a role name
- **AND** the assigned-roles map also contains an assignment for that same name
- **WHEN** any read surface reports the roles map
- **THEN** that role name SHALL NOT appear in the reported roles
- **AND** no write to `~/.pi/agent/providers.json` SHALL occur as a result

#### Scenario: Structurally malformed preset entries are discarded, not fatal

- **GIVEN** `rolePresets` contains a non-object entry, or an entry whose `roles` value is not an object
- **WHEN** any read surface normalizes the configuration
- **THEN** normalization SHALL discard that entry
- **AND** SHALL NOT throw
- **AND** the remaining well-formed presets SHALL be retained

### Requirement: pi-agent-dashboard SHALL define a canonical default role-name set and overlay it at read time

The dashboard SHALL own a canonical default role-name set `DEFAULT_ROLE_NAMES = ["planning", "coding", "compact", "fast", "vision", "research", "naming"]`, defined in the dashboard (not read from pi-flows, which the dashboard no longer depends on for role ownership).

The `naming` role names the model used for automatic session topic-naming. It is a default NAME only: unassigned, the auto-namer falls back to the `fast` role, so adding this name SHALL NOT change resolution for any existing install.

The default set SHALL contribute role NAMES only; it SHALL NOT assign any model. A default role with no assigned model is "unconfigured". The dashboard SHALL overlay the effective role-name schema onto the assigned-roles map at READ time, at every surface that **enumerates the role schema for display** — including the `roles:get-all` response and the HTTP role catalogue endpoint — so that no such surface is ever an empty dead end.

This obligation applies to schema-enumeration surfaces only. Surfaces that **resolve** a single role to a model, and surfaces that deliberately report only roles which have an assigned model, SHALL NOT be required to overlay unassigned names, and their existing behaviour is unchanged by this requirement. Assigned values SHALL win over defaults; non-default assigned roles SHALL be preserved.

The **effective role-name schema** is `(DEFAULT_ROLE_NAMES ∪ roleNames ∪ assigned role keys) − removedRoles`. Every read surface SHALL compute it identically, apply the same overlay, and honour removal markers identically, so no two surfaces disagree about which roles the live configuration contains, or about the value assigned to any of them.

A read surface MAY report **additional** role names beyond the effective schema when its own presentation requires them — for example a surface that also reports stored presets may include role names that appear only inside a preset. Such names SHALL be reported as unassigned in the live configuration, and their presence SHALL NOT be construed as a disagreement between surfaces. No read surface SHALL report a role name for which a removal marker is in effect.

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

#### Scenario: Every read surface agrees on the effective schema

- **GIVEN** a configuration with assigned roles, at least one user-added role, and at least one removal marker in effect
- **WHEN** the roles are read via `roles:get-all` and via the HTTP role catalogue endpoint
- **THEN** both surfaces SHALL report the same effective role-name schema
- **AND** both SHALL report the same assigned value for every role in it
- **AND** neither SHALL report a role name that has a removal marker in effect

#### Scenario: A preset-only role name is not a cross-surface disagreement

- **GIVEN** a stored preset assigns a role name that the live configuration does not contain, and no removal marker applies to it
- **WHEN** the roles are read via `roles:get-all` and via the HTTP role catalogue endpoint
- **THEN** the effective role-name schema reported by both SHALL be unchanged by that preset-only name
- **AND** the HTTP surface MAY additionally report that name, unassigned in the live configuration
