## MODIFIED Requirements

### Requirement: Model roles settings SHALL show what follows each role

The Model roles settings page SHALL list, per role, every projector binding (owner + field + status) and every known resolve-at-use reference that follows that role, so the impact of a role or preset change is visible before it is made. Resolve-at-use automation references SHALL cover every automation the automation plugin currently knows (global and every loaded folder). While the persisted dashboard `defaultModel` is a role ref, it SHALL be listed under that role as `Default model (new sessions)`, without a binding status, following the persisted value with no restart.

#### Scenario: Used-by list for a role
- **GIVEN** blackhole `observerModel` and the grammar model both follow `@fast`
- **WHEN** the user opens the Model roles page
- **THEN** `@fast` SHALL show both usages, with the blackhole binding's status

#### Scenario: Default model listed under its role
- **GIVEN** `defaultModel` is `@planning`
- **WHEN** the user opens the Model roles page
- **THEN** `@planning` SHALL show the usage `Default model (new sessions)`

#### Scenario: Usage follows a changed default
- **GIVEN** `defaultModel` is `@planning`
- **WHEN** the user saves Default model `anthropic/claude-opus-5-5` and reopens the Model roles page
- **THEN** no role SHALL show the usage `Default model (new sessions)`
