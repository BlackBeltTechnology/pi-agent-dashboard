# bridge-default-model-gate Specification

## Purpose

The bridge-default-model-gate is a pure decision predicate that determines whether the bridge applies `config.defaultModel` to a pi session at `session_start` time. It ensures the configured default model is applied ONLY to brand-new sessions that have no prior message history, so that resumed, forked, and reloaded sessions always keep their existing model. The gate mirrors pi's own `hasExistingSession` semantics by deriving its "brand-new" signal from `buildSessionContext().messages.length` rather than the raw entry count.

## Requirements

### Requirement: Apply default model only to brand-new startup sessions

The gate SHALL return true (apply `config.defaultModel`) only when all of the following conditions hold simultaneously: the session start reason is startup, the session has no prior message history, a model registry has been captured from pi, a non-empty default model is configured, and the session's pi process was NOT launched with an explicit `--model` argument. When all conditions hold, the bridge applies the configured default model.

#### Scenario: Brand-new startup session with configured default model

- WHEN a session starts with reason "startup"
- AND the session has zero message-history entries
- AND the bridge has captured a model registry from pi
- AND a non-empty `config.defaultModel` is configured
- AND the pi process was launched without a `--model` argument
- THEN the gate returns true
- AND the bridge applies the configured default model to the session

### Requirement: Never override existing-session models

The gate SHALL return false whenever the session already carries message history, regardless of the start reason. Resumed sessions (started via `--session`), forked sessions (started via `--fork`, whose parent messages are copied into the new session), and reloaded sessions all present a non-zero message-history count and SHALL keep their existing model. The gate SHALL also return false for any start reason other than startup.

#### Scenario: Resumed session keeps its model

- WHEN a session starts with a non-zero message-history count
- THEN the gate returns false
- AND the bridge does not apply the configured default model

#### Scenario: Forked session keeps its model

- WHEN a session starts as a fork whose parent messages have been copied into it
- AND the resulting message-history count is non-zero
- THEN the gate returns false
- AND the bridge does not apply the configured default model

#### Scenario: Non-startup reason is rejected

- WHEN a session starts with a reason other than "startup"
- THEN the gate returns false
- AND the bridge does not apply the configured default model

### Requirement: Require both a model registry and a configured default

The gate SHALL return false when the prerequisites for applying a model are absent: it returns false if the bridge has not yet captured a model registry from pi, and it returns false if no non-empty `config.defaultModel` is configured. Both prerequisites SHALL be satisfied in addition to the brand-new startup conditions before the default model is applied.

#### Scenario: No model registry captured yet

- WHEN a session starts with reason "startup"
- AND the session has zero message-history entries
- AND the bridge has not captured a model registry from pi
- THEN the gate returns false
- AND the bridge does not apply the configured default model

#### Scenario: No default model configured

- WHEN a session starts with reason "startup"
- AND the session has zero message-history entries
- AND the bridge has captured a model registry from pi
- AND no non-empty `config.defaultModel` is configured
- THEN the gate returns false
- AND the bridge does not apply the configured default model

### Requirement: Apply default thinking level alongside the default model

When the default-model gate applies `config.defaultModel` to a brand-new startup
session AND a non-empty `config.defaultThinkingLevel` is configured, the bridge
SHALL also apply that thinking level to the session via pi's thinking-level API
after the model is set. The bridge SHALL rely on pi to clamp the requested level
to the model's capabilities; the bridge SHALL NOT itself reject or pre-validate
the level.

When `config.defaultThinkingLevel` is empty, the bridge SHALL NOT set the thinking
level and pi's own resolution SHALL stand. When the default-model gate does not
apply the default model (resumed, forked, reloaded, or non-startup sessions,
sessions launched with an explicit `--model` argument, or when prerequisites are
absent), the bridge SHALL NOT apply the default thinking level either — the
session keeps its existing level.

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

#### Scenario: Explicit-model session does not receive the default thinking level

- **WHEN** the gate returns false because the session was launched with an explicit `--model` argument
- **AND** a non-empty `config.defaultThinkingLevel` is configured
- **THEN** the bridge does not apply the default thinking level either
- **AND** the session's thinking level is whatever its launch arguments and pi's own resolution produce

### Requirement: Never override an explicitly requested model

The gate SHALL return false (do not apply `config.defaultModel`) when the session's pi process was launched with an explicit `--model` argument, regardless of every other condition. An explicit model on the launch command line is authoritative — the resolved choice of the spawner (subagent agent definition, automation run, worktree init hook, or a user's manual `pi --model` invocation) — and the bridge SHALL leave it intact, matching plain pi CLI behavior. The deferred re-apply path (retry after a custom provider becomes ready) SHALL likewise never apply the default model to such a session.

#### Scenario: Subagent child keeps its agent model

- WHEN a brand-new session starts with reason "startup" and zero message-history entries
- AND the pi process was launched with an explicit `--model` argument
- AND a model registry is captured and a non-empty `config.defaultModel` is configured
- THEN the gate returns false
- AND the session keeps the model from its launch arguments

#### Scenario: Explicit model with custom provider ready later is still not overridden

- WHEN a session launched with an explicit `--model` argument starts brand-new
- AND the configured default model's custom provider becomes available after startup
- THEN the bridge does not apply the configured default model at that later point
- AND the session keeps the model from its launch arguments
