# dashboard-roles-ownership Specification

## Purpose

Establishes pi-agent-dashboard as the sole owner of `~/.pi/agent/providers.json#roles`, `#rolePresets`, and `#activePreset`. Hosts the relocated `flow:role-*` event handlers (previously in pi-flows' `role-manager.ts`), preserves bit-for-bit behaviour, and exposes a single role-reader function consumed by `model:resolve` for `@role` lookups. The `autonomousMode` key remains owned by pi-flows.
## Requirements
### Requirement: pi-agent-dashboard SHALL own `~/.pi/agent/providers.json#roles`, `#rolePresets`, and `#activePreset`

The dashboard extension SHALL be the sole writer of the `roles`, `rolePresets`, and `activePreset` keys in `~/.pi/agent/providers.json`. The dashboard SHALL be a reader of those keys as needed for serving `flow:role-*` events and for `model:resolve` `@role` lookups.

The on-disk format SHALL NOT change. Existing files written by pi-flows' (now-deleted) `role-manager.ts` SHALL be read without migration.

#### Scenario: Reads tolerate a missing file

- **GIVEN** `~/.pi/agent/providers.json` does NOT exist
- **WHEN** any role read is attempted
- **THEN** the read SHALL return an empty `{ roles: {}, rolePresets: [], activePreset: null }` object
- **AND** SHALL NOT throw or log a fatal error

#### Scenario: Reads tolerate malformed JSON

- **GIVEN** `~/.pi/agent/providers.json` contains unparseable JSON
- **WHEN** any role read is attempted
- **THEN** the read SHALL catch the parse error
- **AND** SHALL return the empty `{ roles: {}, … }` object
- **AND** SHALL log a clear warning to stderr including the file path

#### Scenario: Writes use atomic tmp+rename

- **WHEN** the dashboard writes the file
- **THEN** the implementation SHALL write to a `.tmp-<id>` sibling first, fsync, then `rename` to the final path
- **AND** the file MUST NEVER be observed in a partial state by readers

#### Scenario: Writes preserve unrelated keys

- **GIVEN** the file contains `providers`, `roles`, `autonomousMode`, and a hypothetical future key `foo`
- **WHEN** the dashboard updates `roles` only
- **THEN** the file's `providers`, `autonomousMode`, and `foo` keys SHALL be preserved bit-for-bit
- **AND** only the `roles` (and possibly `rolePresets` / `activePreset`) keys SHALL be rewritten

### Requirement: pi-agent-dashboard SHALL NOT read or write `~/.pi/agent/providers.json#autonomousMode`

The `autonomousMode` key in `providers.json` is owned by pi-flows (in its new `extensions/autonomous-mode.ts` module). The dashboard SHALL NOT read this key for any reason and SHALL preserve it during writes.

#### Scenario: Dashboard writes do not touch autonomousMode

- **GIVEN** the file contains `autonomousMode: false`
- **WHEN** the dashboard performs a `flow:role-set` that triggers a write
- **THEN** the post-write file SHALL still contain `autonomousMode: false`

### Requirement: The role-events back-end implementation SHALL live in its own module

The implementation of the five `flow:role-*` handlers SHALL live in a dedicated source file `packages/extension/src/role-manager.ts` (named to mirror pi-flows' soon-deleted file for diff symmetry during review). The module SHALL export an `activate(pi: ExtensionAPI)` function that registers all five handlers.

The dashboard's main bridge module (or `provider-register.ts`, whichever serves as the activation entry today) SHALL call this `activate` exactly once during extension startup.

#### Scenario: Single activate call

- **WHEN** the dashboard extension's top-level `activate(pi)` runs
- **THEN** `packages/extension/src/role-manager.ts::activate(pi)` SHALL be called exactly once
- **AND** that call SHALL register five `pi.events.on(…)` listeners (one per event name above)

### Requirement: `model:resolve` SHALL consult the same `role-manager.ts` reader for `@role` lookups

To avoid duplicate file-read logic, the `model:resolve` listener in `provider-register.ts` SHALL import the role-reader from `role-manager.ts` (a single function such as `getModelRole(role)` or `loadRoles()`) rather than maintaining its own inline `loadRoles()` helper.

#### Scenario: Single reader function is used by both listeners

- **WHEN** `model:resolve` handles `{ ref: "@fast" }`
- **THEN** the listener SHALL call into the same role-reader the `flow:role-get-all` handler uses
- **AND** the inline `loadRoles()` helper currently inside `provider-register.ts` SHALL be removed in favor of that single reader

### Requirement: pi-agent-dashboard SHALL register a `role:resolve-model` listener serving the subagents harness

The dashboard extension SHALL register a `pi.events.on("role:resolve-model", probe)` listener in `role-manager.ts::activate`. This serves `pi-dashboard-subagents` (>= 0.2.0), which resolves an agent definition's `model: "@role"` frontmatter by emitting `role:resolve-model` with a probe-shaped `{ ref: string, resolved?: string, available?: Record<string, string>, reason?: string }` and reading back `probe.resolved`.

The handler SHALL:

- Read `probe.ref` and ignore the event when `probe` is missing/null or `probe.ref` is not a string.
- Strip a single leading `@` from `probe.ref` to obtain the role name; ignore the event when the resulting role name is empty.
- Re-read `~/.pi/agent/providers.json#roles` on every event via the same role reader used by the `flow:role-*` handlers (no duplicate file-read logic).
- Set `probe.available` to the current roles map (so the subagents harness can list assignable roles in its error output).
- Set `probe.resolved` to the role's assigned literal `provider/modelId` when that value is a non-empty string; otherwise leave `probe.resolved` unset.
- When the role is unconfigured (present but with no assigned model, OR absent), set `probe.reason` to a structured "not configured yet" message naming the role (e.g. `role 'fast' not configured yet`). This signals shadow-disabled state to callers without throwing.

The handler SHALL be read-only (no writes to `providers.json`) and SHALL NOT throw on malformed input.

This requirement is additive with respect to `dashboard-model-resolution`: the existing `model:resolve` and deprecated `flow:resolve-model` listeners are unchanged and continue to use their own probe shapes.

#### Scenario: `@role` ref resolves to the assigned model

- **GIVEN** `~/.pi/agent/providers.json#roles` contains `{ fast: "my-google/gemma-4-31b-it" }`
- **WHEN** an emitter calls `pi.events.emit("role:resolve-model", { ref: "@fast" })`
- **THEN** after the emit returns, `probe.resolved` SHALL equal `"my-google/gemma-4-31b-it"`
- **AND** `probe.available` SHALL deep-equal `{ fast: "my-google/gemma-4-31b-it" }`
- **AND** `probe.reason` SHALL be unset

#### Scenario: Bare role name without `@` resolves

- **GIVEN** `roles` contains `{ fast: "anthropic/haiku" }`
- **WHEN** an emitter calls `pi.events.emit("role:resolve-model", { ref: "fast" })`
- **THEN** `probe.resolved` SHALL equal `"anthropic/haiku"`

#### Scenario: Unconfigured role leaves `probe.resolved` unset and sets a structured reason

- **GIVEN** `roles` contains `fast` with no assigned model (default-seeded, unconfigured)
- **WHEN** an emitter calls `pi.events.emit("role:resolve-model", { ref: "@fast" })`
- **THEN** `probe.resolved` SHALL remain `undefined`
- **AND** `probe.reason` SHALL be a non-empty string naming the role as not configured yet
- **AND** `probe.available` SHALL deep-equal the current roles map

#### Scenario: Cross-session role edit is visible

- **GIVEN** the handler is registered
- **WHEN** another writer sets `roles.fast = "x/y"` on disk after activation
- **AND** an emitter then calls `pi.events.emit("role:resolve-model", { ref: "@fast" })`
- **THEN** `probe.resolved` SHALL equal `"x/y"` (the handler re-read disk)
- **AND** `probe.reason` SHALL be unset

### Requirement: pi-agent-dashboard SHALL define a canonical default role-name set and overlay it at read time

The dashboard SHALL own a canonical default role-name set `DEFAULT_ROLE_NAMES = ["planning", "coding", "compact", "fast", "vision", "research"]`, defined in the dashboard (not read from pi-flows, which the dashboard no longer depends on for role ownership).

The default set SHALL contribute role NAMES only; it SHALL NOT assign any model. A default role with no assigned model is "unconfigured". The dashboard SHALL overlay the effective role-name schema onto the assigned-roles map at READ time (in the `roles:get-all` response) so the Roles UI is never an empty dead end. Assigned values SHALL win over defaults; non-default assigned roles SHALL be preserved.

The role-name schema SHALL be USER-EDITABLE. `DEFAULT_ROLE_NAMES` seeds the schema for display but is NOT immutable: a user (or the `update_roles` tool) MAY add a role name (implicitly, by assigning a model to a new name) and MAY remove any role name — including a default. Removal is a purge (see the removal requirement below); once removed, a default name SHALL NOT be re-injected by the read-time overlay for that role while a removal marker is in effect. The dashboard SHALL NOT auto-write default role names to `providers.json`; a role reaches disk only when a model is assigned.

#### Scenario: Default role names available on a fresh install

- **GIVEN** `~/.pi/agent/providers.json` has no `roles` key (or an empty `roles` map) and no removal markers
- **WHEN** the Roles back-end reports the roles map (via `roles:get-all`)
- **THEN** the reported roles SHALL include every name in `DEFAULT_ROLE_NAMES`
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

### Requirement: The Roles settings panel SHALL render default roles and a setup prompt instead of an empty state

The Roles settings UI (`RolesSettingsSection.tsx`) SHALL render one row per role in the effective roles map (persisted ∪ defaults). When no role has an assigned model, the panel SHALL remain enabled and loaded ("shadow-disabled"), render each default role row with an unassigned placeholder, and show a single banner reading "No roles have been set up — set up now". The legacy empty-state message referencing pi-flows SHALL be removed.

#### Scenario: Fresh install shows default rows and setup banner

- **GIVEN** no role has an assigned model
- **WHEN** the Roles settings panel renders
- **THEN** it SHALL display a row for every name in `DEFAULT_ROLE_NAMES`, each with an unassigned model placeholder
- **AND** it SHALL display a "No roles have been set up — set up now" banner
- **AND** it SHALL NOT display the legacy "install … pi-flows" empty-state text

#### Scenario: Configured roles hide the setup banner

- **GIVEN** at least one role has an assigned model
- **WHEN** the panel renders
- **THEN** the "set up now" banner SHALL NOT be shown

### Requirement: pi-agent-dashboard SHALL register the `roles:*` event handlers

The dashboard extension SHALL register listeners for five dashboard-owned role events under the `roles:` namespace: `roles:get-all`, `roles:set`, `roles:preset-load`, `roles:preset-save`, `roles:preset-delete`. Behaviour is preserved bit-for-bit from the former `flow:role-*` handlers: re-read the file on every event; loading a preset replaces `roles` wholesale; setting a role while a preset is active updates that preset in-place; mutating events set a `success` boolean. No `flow:`-prefixed alias SHALL be retained.

#### Scenario: roles:get-all returns roles + presets + activePreset

- **GIVEN** the file contains `roles: { fast: "anthropic/opus" }, rolePresets: [{ name: "default", roles: {} }], activePreset: "default"`
- **WHEN** an emitter calls `pi.events.emit("roles:get-all", data)`
- **THEN** `data.roles` SHALL include `fast: "anthropic/opus"` (with the read-time schema overlay)
- **AND** `data.presets` SHALL contain the `default` preset
- **AND** `data.activePreset` SHALL equal `"default"`

#### Scenario: roles:set persists immediately

- **WHEN** an emitter calls `pi.events.emit("roles:set", { role: "coding", modelId: "anthropic/claude-opus-4" })`
- **THEN** `data.success` SHALL be `true`
- **AND** the on-disk file SHALL contain `roles.coding === "anthropic/claude-opus-4"`

#### Scenario: No flow:-prefixed role event is registered

- **WHEN** the dashboard extension's `activate(pi)` runs
- **THEN** it SHALL register the five `roles:*` listeners
- **AND** it SHALL NOT register any `flow:role-*` listener (no compatibility alias)

### Requirement: The `roles:get-all` payload SHALL advertise the built-in role-name set

The `roles:get-all` response (and the `roles_list` WebSocket payload the bridge forwards to the client) SHALL include a `builtinRoleNames: string[]` field equal to `DEFAULT_ROLE_NAMES`. This lets the human UI classify each role as Built-in or Custom without duplicating the default-name constant in the client. The field SHALL be additive; consumers that do not read it SHALL be unaffected.

The field SHALL survive the full relay to the browser. The server's `roles_list` re-broadcast to browser clients SHALL forward `builtinRoleNames`, and the browser-facing `roles_list` message type SHALL carry it. The client's `roles_list` handler SHALL write `builtinRoleNames` into the roles plugin config so the Roles settings panel can render the Built-in/Custom split and the "＋ Add custom role" control. A relay hop that omits the field is a defect, since it collapses the UI to the flat back-compat layout and makes custom roles unreachable.

#### Scenario: builtinRoleNames mirrors DEFAULT_ROLE_NAMES

- **GIVEN** the Roles back-end responds to `roles:get-all`
- **THEN** the response SHALL include `builtinRoleNames` equal to `["planning", "coding", "compact", "fast", "vision", "research"]`
- **AND** the field SHALL be present regardless of how many roles have assigned models

#### Scenario: builtinRoleNames survives the server→browser relay

- **GIVEN** the bridge emits a `roles_list` message carrying `builtinRoleNames`
- **WHEN** the server re-broadcasts `roles_list` to browser clients
- **THEN** the broadcast message SHALL include the same `builtinRoleNames` array
- **AND** the client `roles_list` handler SHALL write `builtinRoleNames` into the `roles` plugin config
- **AND** the Roles settings panel SHALL render the Built-in/Custom groups and the "＋ Add custom role" control

### Requirement: A `role_remove` message SHALL purge a custom role from the schema and every preset

The dashboard SHALL accept a human-initiated `role_remove` message (client → bridge → `roles:remove`) that removes a role via the existing `removeRoleFromSchema` path: the role SHALL be deleted from the role-name schema, the active roles map, and every preset's roles map in a single atomic write, then a fresh `roles_list` SHALL be emitted. This is the human-facing counterpart of the `update_roles` tool's `remove_role` action.

The handler SHALL re-validate the target name and SHALL reject a name in `DEFAULT_ROLE_NAMES` (built-in roles are permanent from the UI); a rejected removal SHALL perform no write and report failure. Unrelated top-level keys of `providers.json` SHALL be preserved.

#### Scenario: role_remove purges a custom role everywhere

- **GIVEN** presets `cheap` and `premium` both bind a custom role `doubt-verifier-1`
- **WHEN** a `role_remove` message with `role = "doubt-verifier-1"` is processed
- **THEN** `doubt-verifier-1` SHALL be absent from the active roles map, from `cheap`, and from `premium`
- **AND** a `roles_list` payload reflecting the removal SHALL be emitted
- **AND** other top-level keys of `providers.json` SHALL be unchanged

#### Scenario: role_remove refuses a built-in role

- **GIVEN** a `role_remove` message with `role = "planning"` (a built-in)
- **WHEN** it is processed
- **THEN** no write SHALL occur and the operation SHALL report failure
- **AND** `planning` SHALL remain in the effective role-name schema

