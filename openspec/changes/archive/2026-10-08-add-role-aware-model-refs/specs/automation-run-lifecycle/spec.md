## MODIFIED Requirements

### Requirement: Model resolution at spawn time

When `model` is a role ref (`@<role>[:<level>]`), it SHALL be resolved to a concrete provider/model at spawn time via the shared role resolver (the same resolver used by every other dashboard consumer), honoring a ref-level thinking override. A bare provider/model id SHALL be used as-is. An unresolvable `@role` SHALL fall back to a configured default model and surface a run error rather than silently selecting a model. The concrete model passed to the spawn SHALL carry the resolved thinking level as a `:<level>` suffix when one is present (ref level first, else the role assignment's level).

#### Scenario: @role resolved live

- **WHEN** an automation with `model: "@fast"` fires and `@fast` maps to a concrete model
- **THEN** the run SHALL spawn with that concrete model.

#### Scenario: Unresolvable role surfaces error

- **WHEN** an automation references `@gone` which has no assignment
- **THEN** the run SHALL use the configured default model AND record a run error noting the unresolved role.

#### Scenario: Role level suffix is preserved

- **GIVEN** role `fast` is assigned `anthropic/claude-haiku-4-5:low`
- **WHEN** an automation with `model: "@fast"` fires
- **THEN** the run SHALL spawn with `anthropic/claude-haiku-4-5:low`.
