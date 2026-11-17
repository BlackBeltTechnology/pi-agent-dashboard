## ADDED Requirements

### Requirement: Role-ref default model resolves at application time

When `config.defaultModel` is a role ref (`@<role>` or `@<role>:<level>`), the bridge SHALL resolve it against the role map on disk at the moment it applies the default model — at `session_start` and on the deferred custom-provider retry path — and SHALL apply the resolved `provider/id` under the same brand-new-session gate as a concrete default. The bridge SHALL NOT cache the resolution across sessions, so a preset Load or role edit made before a session starts determines that session's model.

When the role does not resolve to a `provider/id` (unknown role, no model assigned in the effective role map, or an assigned value without `provider/`), the bridge SHALL NOT call `pi.setModel()`, SHALL NOT enter the pending-retry path, SHALL leave pi's own model resolution intact, and SHALL log one line naming the role. When the role resolves to a model not yet present in the model registry, the bridge SHALL use the existing pending-retry path; the retry SHALL resolve the role again, so the model applied is the role's resolution at the moment it is applied.

Running and resumed sessions SHALL NOT change model when the role map changes.

#### Scenario: Role default resolves to the active preset's model
- **GIVEN** `config.defaultModel` is `@planning` and role `planning` is assigned `anthropic/claude-sonnet-5-5`
- **WHEN** a brand-new startup session passes the default-model gate
- **THEN** the bridge SHALL call `pi.setModel()` with `anthropic/claude-sonnet-5-5`

#### Scenario: Preset load changes the next new session's model
- **GIVEN** `config.defaultModel` is `@planning`
- **WHEN** the user loads a preset assigning `planning` to `proxy/cc/claude-sonnet-5-5` and then starts a brand-new session
- **THEN** the bridge SHALL call `pi.setModel()` with `proxy/cc/claude-sonnet-5-5`

#### Scenario: Running session keeps its model across a preset load
- **GIVEN** a running session started with `@planning` resolved to `anthropic/claude-sonnet-5-5`
- **WHEN** the user loads a preset assigning `planning` to a different model
- **THEN** the running session's model SHALL remain `anthropic/claude-sonnet-5-5`

#### Scenario: Unassigned role falls back to pi's default
- **GIVEN** `config.defaultModel` is `@validate` and `validate` has no model in the effective role map
- **WHEN** a brand-new startup session passes the default-model gate
- **THEN** the bridge SHALL NOT call `pi.setModel()`
- **AND** the bridge SHALL log one line naming `@validate`
- **AND** the session's model SHALL be pi's own resolution

#### Scenario: Resolved model from a late custom provider applies on retry
- **GIVEN** `config.defaultModel` is `@planning` resolving to `local/ocg/longcat-2.5-preview-free`, whose provider is not ready at startup
- **WHEN** the provider's models become available and the role map is unchanged
- **THEN** the bridge SHALL apply `local/ocg/longcat-2.5-preview-free` through the pending-retry path

#### Scenario: Role assigned a value without a provider is unresolved
- **GIVEN** `config.defaultModel` is `@coding` and role `coding` is assigned `claude-haiku-5-5` (no `provider/`)
- **WHEN** a brand-new startup session passes the default-model gate
- **THEN** the bridge SHALL NOT call `pi.setModel()` and SHALL log one line naming `@coding`
