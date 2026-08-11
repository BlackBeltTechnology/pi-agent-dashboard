# invoicebot-session-profile — delta

## ADDED Requirements

### Requirement: Every invoice-owned spawn pins the configured model

The invoice plugin SHALL pass an explicitly resolved model on EVERY session it
spawns — both the scoped per-invoice detail session and the processing/automation
run session — so no invoice-owned spawn inherits an unrelated host default
provider. The resolved value SHALL be supplied through the host's existing spawn
model option as a `provider/modelId` string.

The plugin SHALL resolve that model by first-valid-wins precedence:

1. the invoice plugin's own trusted configuration (`model`, else `defaultModel`),
2. the dashboard configuration's `defaultModel`,
3. the `IB_MODEL` environment variable,
4. otherwise no model is passed and the host default applies unchanged.

Every candidate SHALL be validated as `provider/modelId` with both parts
non-empty and free of whitespace and control characters. An invalid candidate
SHALL be logged and skipped so resolution continues down the precedence chain;
it SHALL NOT throw and SHALL NOT prevent the spawn. Resolution SHALL read
configuration values only and SHALL NOT read, log or forward any credential.

#### Scenario: scoped detail spawn uses the configured model

- **WHEN** the dashboard configuration sets `defaultModel` to
  `openai-codex/gpt-5.4` and a scoped session is spawned for an invoice
- **THEN** the spawn SHALL carry model `openai-codex/gpt-5.4`
- **AND** it SHALL NOT fall back to the host's built-in default provider

#### Scenario: processing run spawn uses the configured model

- **WHEN** a flow-dispatching spawn runs for an invoice under that same
  configuration
- **THEN** that spawn SHALL carry the identical resolved model

#### Scenario: plugin configuration outranks dashboard and environment

- **WHEN** the plugin's own configuration names a valid model AND the dashboard
  configuration and `IB_MODEL` name different valid models
- **THEN** the spawn SHALL carry the plugin-configured model

#### Scenario: environment backstop

- **WHEN** neither the plugin nor the dashboard configuration names a model and
  `IB_MODEL` names a valid one
- **THEN** the spawn SHALL carry the `IB_MODEL` model

#### Scenario: malformed configuration falls back safely

- **WHEN** a higher-precedence candidate is malformed (missing provider or
  model id, or containing whitespace)
- **THEN** it SHALL be skipped with a warning
- **AND** the next valid candidate in the chain SHALL be used
- **AND** the spawn SHALL still occur

#### Scenario: no configured model preserves host behaviour

- **WHEN** no plugin config, dashboard `defaultModel` or `IB_MODEL` is present
- **THEN** the spawn SHALL omit the model option entirely, exactly as before
