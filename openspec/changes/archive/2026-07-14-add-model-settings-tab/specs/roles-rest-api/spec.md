## ADDED Requirements

### Requirement: Session-less GET /api/roles SHALL read the role slice read-only

The server SHALL expose `GET /api/roles`, a session-less, read-only route over
the role slice of `~/.pi/agent/providers.json`. It SHALL return
`{ roles, rolePresets, activePreset, builtinRoleNames }`, where `roles` is the
on-disk assignments overlaid with the canonical `DEFAULT_ROLE_NAMES` (assigned
values win; unconfigured defaults appear as empty strings), and
`builtinRoleNames` is the canonical default-name list. The route SHALL be
network-guarded (same posture as the other config routes). The route SHALL NOT
mutate or create any file, and this change SHALL NOT introduce a `PUT` (or any
other mutating) `/api/roles` route.

#### Scenario: Returns assigned roles overlaid with empty defaults

- **WHEN** `providers.json#roles` assigns a model to some roles
- **THEN** `GET /api/roles` SHALL return those assignments
- **AND** the remaining `DEFAULT_ROLE_NAMES` SHALL appear with empty-string values
- **AND** the response SHALL include `builtinRoleNames`, `rolePresets`, and `activePreset`

#### Scenario: Missing file yields empty structures without creating it

- **WHEN** `~/.pi/agent/providers.json` does not exist
- **THEN** `GET /api/roles` SHALL return empty `roles` (defaults overlaid), `rolePresets: []`, `activePreset: null`
- **AND** SHALL NOT create the file

#### Scenario: A read never mutates the file

- **WHEN** `GET /api/roles` is called against an existing `providers.json`
- **THEN** the file on disk SHALL be byte-for-byte unchanged after the call

#### Scenario: No write route exists

- **WHEN** a `PUT /api/roles` request is made
- **THEN** the server SHALL NOT handle it as a role write (no such route is registered by this change)

#### Scenario: Route is network-guarded

- **WHEN** the request does not satisfy the network guard
- **THEN** the route SHALL reject it the same way the other config routes do
