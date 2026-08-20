## ADDED Requirements

### Requirement: Apply default thinking level alongside the default model

When the default-model gate applies `config.defaultModel` to a brand-new startup
session AND a non-empty `config.defaultThinkingLevel` is configured, the bridge
SHALL also apply that thinking level to the session via pi's thinking-level API
after the model is set. The bridge SHALL rely on pi to clamp the requested level
to the model's capabilities; the bridge SHALL NOT itself reject or pre-validate
the level.

When `config.defaultThinkingLevel` is empty, the bridge SHALL NOT set the thinking
level and pi's own resolution SHALL stand. When the default-model gate does not
apply the default model (resumed, forked, reloaded, or non-startup sessions, or
when prerequisites are absent), the bridge SHALL NOT apply the default thinking
level either — the session keeps its existing level.

#### Scenario: Brand-new startup applies both model and thinking level

- **WHEN** the default-model gate applies `config.defaultModel` to a brand-new startup session
- **AND** `config.defaultThinkingLevel` is a non-empty value
- **THEN** the bridge applies the configured model
- **AND** the bridge applies the configured thinking level via pi's thinking-level API

#### Scenario: Empty default thinking level leaves pi resolution intact

- **WHEN** the default-model gate applies `config.defaultModel` to a brand-new startup session
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
