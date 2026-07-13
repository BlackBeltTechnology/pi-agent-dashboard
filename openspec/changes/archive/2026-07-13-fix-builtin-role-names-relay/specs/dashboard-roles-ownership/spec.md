## MODIFIED Requirements

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
