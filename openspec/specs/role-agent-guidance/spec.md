# role-agent-guidance Specification

## Purpose
Agent tool role guidance contributed by the roles plugin bridge: when the Roles plugin is enabled and the Agent tool is selected, one system-prompt guideline tells the model to prefer `model: "@role"` refs and lists the configured roles.

## Requirements

### Requirement: The roles plugin SHALL add role guidance to the Agent tool

The roles plugin SHALL ship a bridge entry that, before each agent run, reads the effective role map through the `roles:get-all` bus probe and, when at least one role has an assigned model and the `Agent` tool is registered, appends one guideline to the Agent tool's guidelines telling the model to call the `list_roles` tool to discover the available roles and then prefer `model: "@<role>"` over a literal model id. The guideline SHALL NOT enumerate role names or model refs; role discovery is delegated to `list_roles`, so no role is ever dropped by a prompt-side cap. The guideline SHALL be recomputed each run so role edits apply on the next turn. The guideline SHALL be present in the system prompt actually sent to the provider, not only in the recorded structured prompt options; first-party dashboard extensions SHALL NOT replace the system prompt wholesale in a way that drops it. Core and the subagents producer SHALL NOT contain this guidance.

#### Scenario: Roles exist
- **GIVEN** roles `fast → anthropic/claude-haiku-4-5` and `review → openai-codex/gpt-6-sol`
- **WHEN** an agent run starts with the Agent tool active
- **THEN** the system prompt's Agent tool guidelines SHALL contain one role-guidance bullet that names the `list_roles` tool and the `model: "@<role>"` form
- **AND** the bullet SHALL NOT contain `@fast`, `@review`, or any model ref

#### Scenario: Many roles are never truncated
- **GIVEN** 13 roles with assigned models
- **WHEN** an agent run starts with the Agent tool active
- **THEN** the bullet SHALL be the same pointer text as with 2 roles (no list, no cap)

#### Scenario: Guidance reaches the provider alongside first-party injectors
- **GIVEN** roles exist, the Agent tool is active, and the dashboard session-context injector and the kb doctrine injector are both active
- **WHEN** an agent run starts
- **THEN** the system prompt sent to the provider SHALL contain the role-guidance bullet
- **AND** SHALL also contain the dashboard session-context fragment and the dox doctrine fragment

#### Scenario: No roles
- **GIVEN** an empty role map
- **WHEN** an agent run starts
- **THEN** no role-guidance bullet SHALL be added

#### Scenario: Fresh install with only unassigned built-in role names
- **GIVEN** the role map holds built-in role names whose model value is empty
- **WHEN** an agent run starts
- **THEN** no role-guidance bullet SHALL be added

#### Scenario: Role change applies next turn
- **GIVEN** an empty role map, so no bullet was added
- **WHEN** the user assigns a model to role `deep` and a new run starts
- **THEN** the role-guidance bullet SHALL be added

### Requirement: Role guidance SHALL exist only while the roles plugin is enabled

Plugin bridges SHALL be registered only for enabled plugins and removed when a plugin is disabled, so the role guidance is absent whenever the roles plugin is disabled (effective from the next pi session start).

#### Scenario: Roles plugin disabled
- **GIVEN** `plugins.roles.enabled = false`
- **WHEN** the dashboard server starts and a new pi session starts
- **THEN** the roles plugin bridge SHALL NOT be loaded and no role-guidance bullet SHALL be added

#### Scenario: Default-disabled plugin without explicit config
- **GIVEN** a plugin whose manifest sets `defaultEnabled: false` and no `plugins.<id>` config
- **WHEN** the server registers plugin bridges
- **THEN** its bridge SHALL NOT be registered

#### Scenario: Plugin bridge registration follows enablement
- **GIVEN** a plugin with a `bridge` manifest entry and `plugins.<id>.enabled = false`
- **WHEN** the server registers plugin bridges
- **THEN** neither `dashboardPluginBridges["dashboard-<id>"]` nor its managed `packages[]` entry SHALL be present
