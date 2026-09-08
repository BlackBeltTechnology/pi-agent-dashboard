## MODIFIED Requirements

### Requirement: Apply default model only to brand-new startup sessions

The gate SHALL return true (apply `config.defaultModel`) only when all of the following conditions hold simultaneously: the session start reason is startup, the session has no prior message history, a model registry has been captured from pi, a non-empty default model is configured, and none of the protected startup signals is present (`--model`, `PI_SUBAGENT_CHILD`, or a startup model different from the complete global Pi configured default pair). When all conditions hold, the bridge applies the configured default model.

#### Scenario: Brand-new startup session with configured default model

- WHEN a session starts with reason "startup"
- AND the session has zero message-history entries
- AND the bridge has captured a model registry from pi
- AND a non-empty `config.defaultModel` is configured
- AND no protected startup signal is present
- THEN the gate returns true
- AND the bridge applies the configured default model to the session

## ADDED Requirements

### Requirement: Preserve SDK startup model signals

The bridge SHALL suppress the Dashboard default model and thinking level when `PI_SUBAGENT_CHILD` is present in the environment, or when the startup provider/modelId pair differs from the complete `defaultProvider`/`defaultModel` pair in `~/.pi/agent/settings.json`. The existing literal `--model` protection SHALL remain unchanged. Suppressed sessions SHALL NOT receive deferred default application when a provider becomes ready.

The bridge SHALL compare the startup model captured before asynchronous startup work. Missing settings or an incomplete default pair SHALL leave only the argv and child-marker checks active. Invalid or unreadable settings SHALL report an error and SHALL NOT cause a guessed default application.

An unmarked arbitrary SDK caller explicitly selecting exactly Pi's configured default SHALL retain ordinary Dashboard-default behavior, because the available startup data does not distinguish that choice from automatic selection.

#### Scenario: Marked SDK child chooses Pi default

- **WHEN** a fresh SDK session has `PI_SUBAGENT_CHILD` present, including an empty value
- **AND** its selected model equals Pi's configured default and argv contains no `--model`
- **THEN** the Dashboard default model and thinking level are not applied
- **AND** later provider readiness does not apply either default

#### Scenario: Unmarked SDK caller selects another model

- **WHEN** a fresh SDK session has no child marker or `--model` token
- **AND** its startup provider or modelId differs from the complete global configured pair
- **THEN** its startup model and thinking level are preserved
- **AND** later provider readiness does not apply either Dashboard default

#### Scenario: Plain new session uses the Dashboard default

- **WHEN** a fresh session has no child marker or `--model` token
- **AND** its startup model equals Pi's configured default
- **AND** the usual startup, empty-history, registry, and configured Dashboard-default conditions hold
- **THEN** the Dashboard default is applied

#### Scenario: Same-default arbitrary SDK choice has no provenance

- **WHEN** an arbitrary SDK caller explicitly selects exactly Pi's configured default
- **AND** it supplies neither a child marker nor a `--model` token
- **THEN** the same ordinary new-session Dashboard-default rules apply

#### Scenario: No complete global configured pair

- **WHEN** global settings are absent or either default field is absent or empty
- **AND** a fresh session has neither child marker nor explicit argv model
- **THEN** no startup-model difference is inferred
- **AND** ordinary new-session Dashboard-default rules apply

#### Scenario: Settings cannot be interpreted

- **WHEN** startup comparison encounters invalid JSON or a settings read error other than a missing file
- **THEN** the bridge reports the settings path in an error
- **AND** it does not apply the Dashboard default
