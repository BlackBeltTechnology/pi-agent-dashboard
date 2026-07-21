# bridge-default-model-gate Specification

## Purpose

The bridge-default-model-gate is a pure decision predicate that determines whether the bridge applies `config.defaultModel` to a pi session at `session_start` time. It ensures the configured default model is applied ONLY to brand-new sessions that have no prior message history, so that resumed, forked, and reloaded sessions always keep their existing model. The gate mirrors pi's own `hasExistingSession` semantics by deriving its "brand-new" signal from `buildSessionContext().messages.length` rather than the raw entry count.

## Requirements

### Requirement: Apply default model only to brand-new startup sessions

The gate SHALL return true (apply `config.defaultModel`) only when all of the following conditions hold simultaneously: the session start reason is startup, the session has no prior message history, a model registry has been captured from pi, and a non-empty default model is configured. When all conditions hold, the bridge applies the configured default model.

#### Scenario: Brand-new startup session with configured default model

- WHEN a session starts with reason "startup"
- AND the session has zero message-history entries
- AND the bridge has captured a model registry from pi
- AND a non-empty `config.defaultModel` is configured
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
