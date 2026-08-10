# dashboard-bus-client-denylist Specification

## Purpose
Some `BrowserToServerMessage` command verbs are intercepted client-side and routed to REST rather than forwarded over the WebSocket bus (e.g. `plugin_config_write` → `POST /api/config/plugins/:id`). The denylist names these verbs so verb code generation excludes them and never emits a WebSocket helper that would silently fail.

## Requirements

### Requirement: Denylist membership and query
The bus-client package SHALL expose the set of client-intercepted verbs and a predicate to test membership.

#### Scenario: Denylist contains the intercepted verbs
- **WHEN** a caller reads `CLIENT_INTERCEPTED_DENYLIST`
- **THEN** the value is a read-only list of verb `type` strings
- **AND** it contains `plugin_config_write`

#### Scenario: Membership query on a denied verb
- **WHEN** `isDenylisted("plugin_config_write")` is called
- **THEN** it returns `true`

#### Scenario: Membership query on a forwardable verb
- **WHEN** `isDenylisted` is called with a verb not on the list (e.g. `spawn_session`)
- **THEN** it returns `false`

### Requirement: Exclusion from generated verbs
Verb code generation SHALL exclude every denylisted member from the generated command surface, so no WebSocket helper is emitted for a verb that is intercepted client-side.

#### Scenario: Denied member absent from generated verbs
- **WHEN** the verb generator enumerates the `BrowserToServerMessage` union and renders the output
- **THEN** `GENERATED_VERBS` and `VERB_INTERFACE` omit every verb for which `isDenylisted` returns `true`
- **AND** `plugin_config_write` is a real union member yet does not appear in `GENERATED_VERBS`

#### Scenario: Generation reports what it excluded
- **WHEN** generation runs
- **THEN** it returns the count of emitted verbs and the list of excluded (denylisted) verbs
- **AND** the excluded verbs are the members that satisfy `isDenylisted`

### Requirement: Forwardable-verb completeness
The generated command surface SHALL contain only forwardable verbs, so that a completeness check can assert every generated verb reaches a real server-side handler.

#### Scenario: Every denylist member is excluded
- **WHEN** the generated verbs are checked against the denylist
- **THEN** no denylisted verb appears in `GENERATED_VERBS`

#### Scenario: Non-denied members remain forwardable
- **WHEN** a `BrowserToServerMessage` member is not on the denylist
- **THEN** it is retained in `GENERATED_VERBS` and mapped to its union-member interface in `VERB_INTERFACE`
