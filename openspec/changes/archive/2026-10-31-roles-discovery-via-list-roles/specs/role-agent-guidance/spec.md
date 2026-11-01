## MODIFIED Requirements

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
