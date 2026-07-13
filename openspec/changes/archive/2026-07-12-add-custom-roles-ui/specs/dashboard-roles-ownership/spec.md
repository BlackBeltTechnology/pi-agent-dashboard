## ADDED Requirements

### Requirement: The `roles:get-all` payload SHALL advertise the built-in role-name set

The `roles:get-all` response (and the `roles_list` WebSocket payload the bridge forwards to the client) SHALL include a `builtinRoleNames: string[]` field equal to `DEFAULT_ROLE_NAMES`. This lets the human UI classify each role as Built-in or Custom without duplicating the default-name constant in the client. The field SHALL be additive; consumers that do not read it SHALL be unaffected.

#### Scenario: builtinRoleNames mirrors DEFAULT_ROLE_NAMES

- **GIVEN** the Roles back-end responds to `roles:get-all`
- **THEN** the response SHALL include `builtinRoleNames` equal to `["planning", "coding", "compact", "fast", "vision", "research"]`
- **AND** the field SHALL be present regardless of how many roles have assigned models

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
