## MODIFIED Requirements

### Requirement: Apply default thinking level alongside the default model

When the default-model gate applies `config.defaultModel` to a brand-new startup
session AND a non-empty `config.defaultThinkingLevel` is configured, the bridge
SHALL also apply that thinking level to the session via pi's thinking-level API
after the model is set. When `config.defaultThinkingLevel` is empty and
`config.defaultModel` is a role ref (`@<role>` or `@<role>:<level>`), the bridge
SHALL apply the ref's `:<level>` suffix, else the level assigned to the role, when
one exists. The bridge SHALL rely on pi to clamp the requested level to the
model's capabilities; the bridge SHALL NOT itself reject or pre-validate the
level.

When no level results (empty `config.defaultThinkingLevel` and, for a role ref,
no suffix and no role level), the bridge SHALL NOT set the thinking level and
pi's own resolution SHALL stand. When the default-model gate does not apply the
default model (resumed, forked, reloaded, or non-startup sessions, sessions
launched with an explicit `--model` argument, or when prerequisites are absent),
the bridge SHALL NOT apply the default thinking level either — the session keeps
its existing level.

#### Scenario: Brand-new startup applies both model and thinking level

- **WHEN** the default-model gate applies `config.defaultModel` to a brand-new startup session
- **AND** `config.defaultThinkingLevel` is a non-empty value
- **THEN** the bridge applies the configured model
- **AND** the bridge applies the configured thinking level via pi's thinking-level API

#### Scenario: Empty default thinking level leaves pi resolution intact

- **WHEN** the default-model gate applies a concrete `config.defaultModel` to a brand-new startup session
- **AND** `config.defaultThinkingLevel` is an empty string
- **THEN** the bridge does not set the thinking level
- **AND** the session's thinking level is whatever pi resolves on its own

#### Scenario: Requested level unsupported by the model is clamped by pi

- **WHEN** the bridge applies a configured `defaultThinkingLevel` that the resolved model does not support
- **THEN** the bridge passes the level to pi unchanged
- **AND** the effective session level is pi's clamped result, not an error

#### Scenario: Custom-provider-late default model applies the level on resolution

- **WHEN** the configured default model belongs to a custom provider whose models are not yet available at startup
- **AND** `config.defaultThinkingLevel` is a non-empty value
- **AND** the provider's models later become available and the default model is applied at that point
- **THEN** the bridge applies the configured thinking level at the same time the model is applied

#### Scenario: Resumed session does not apply the default thinking level

- **WHEN** a session starts with a non-zero message-history count
- **AND** `config.defaultThinkingLevel` is a non-empty value
- **THEN** the gate does not apply the default model
- **AND** the bridge does not apply the default thinking level
- **AND** the session keeps its existing thinking level

#### Scenario: Explicit-model session does not receive the default thinking level

- **WHEN** the gate returns false because the session was launched with an explicit `--model` argument
- **AND** a non-empty `config.defaultThinkingLevel` is configured
- **THEN** the bridge does not apply the default thinking level either
- **AND** the session's thinking level is whatever its launch arguments and pi's own resolution produce

#### Scenario: Role-assigned level applies when the Settings level is empty

- **GIVEN** `config.defaultModel` is `@planning`, role `planning` is assigned `anthropic/claude-sonnet-5-5:high`, and `config.defaultThinkingLevel` is `""`
- **WHEN** the gate applies the default to a brand-new startup session
- **THEN** the bridge applies model `anthropic/claude-sonnet-5-5`
- **AND** the bridge applies thinking level `high`

#### Scenario: Settings level beats the role level

- **GIVEN** `config.defaultModel` is `@planning`, role `planning` is assigned `anthropic/claude-sonnet-5-5:high`, and `config.defaultThinkingLevel` is `low`
- **WHEN** the gate applies the default to a brand-new startup session
- **THEN** the bridge applies thinking level `low`

#### Scenario: Ref suffix beats the role level

- **GIVEN** `config.defaultModel` is `@planning:medium`, role `planning` is assigned `anthropic/claude-sonnet-5-5:high`, and `config.defaultThinkingLevel` is `""`
- **WHEN** the gate applies the default to a brand-new startup session
- **THEN** the bridge applies thinking level `medium`

#### Scenario: Role without any level leaves pi's level resolution intact

- **GIVEN** `config.defaultModel` is `@coding`, role `coding` is assigned `anthropic/claude-haiku-5-5` with no level, and `config.defaultThinkingLevel` is `""`
- **WHEN** the gate applies the default to a brand-new startup session
- **THEN** the bridge applies model `anthropic/claude-haiku-5-5`
- **AND** the bridge does not set the thinking level
