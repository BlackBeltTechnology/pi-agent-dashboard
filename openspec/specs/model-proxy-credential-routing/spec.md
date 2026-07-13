# model-proxy-credential-routing Specification

## Purpose
Rules for matching pi-ai models against the active credential set per provider: OAuth-vs-api-key routability, the hand-maintained per-model `oauthCompatible` override table, and a diagnostic surface exposing why each model is included in or excluded from `/v1/models`.
## Requirements
### Requirement: Credential-kind aware model filtering

The dashboard model proxy SHALL filter `/v1/models` and `find()` results by the *kind* of credential available for each model's provider, not only by provider presence.

For each model, the system SHALL include it in the available set only when at least one credential for its provider can route it:

- An `api_key` credential with non-empty `key` SHALL be considered able to route every model of that provider.
- An `oauth` credential with a non-empty `access` or `refresh` token SHALL be considered able to route a model only when that model's `oauthCompatible` flag is `true` (default) or absent.
- A provider with no credential at all SHALL exclude all of its models, as today.

#### Scenario: OAuth-only credential excludes legacy snapshot
- **WHEN** `~/.pi/agent/auth.json` has only an `anthropic` OAuth credential and the registry contains `anthropic/claude-3-5-haiku-20241022` (flagged `oauthCompatible: false`)
- **THEN** `/v1/models` SHALL NOT list that model and `registry.find("anthropic", "claude-3-5-haiku-20241022")` SHALL return `null`

#### Scenario: OAuth-only credential includes current allowlist model
- **WHEN** the same OAuth-only setup queries `anthropic/claude-haiku-4-5` (default `oauthCompatible: true`)
- **THEN** `/v1/models` SHALL list that model and `find()` SHALL return its entry

#### Scenario: API key credential routes every model of its provider
- **WHEN** `auth.json` has an `anthropic` `api_key` credential (with no OAuth credential)
- **THEN** every Anthropic model in the registry SHALL appear in `/v1/models`, including ones flagged `oauthCompatible: false`

#### Scenario: No credential excludes provider entirely
- **WHEN** `auth.json` has no credential for `openai`
- **THEN** no `openai/*` model SHALL appear in `/v1/models`

### Requirement: Per-model OAuth compatibility flag

Each model entry in the registry SHALL carry an optional `oauthCompatible: boolean` flag (default `true` when omitted). Built-in models from pi-ai SHALL have the flag set automatically from a hand-maintained override table keyed by `(provider, modelId)`. Custom models from `~/.pi/agent/models.json` SHALL accept an explicit `oauthCompatible` field that overrides the default.

#### Scenario: Built-in model inherits flag from override table
- **WHEN** the override table marks `anthropic/claude-3-5-haiku-20241022` as OAuth-incompatible and the registry loads built-in pi-ai models
- **THEN** the loaded `claude-3-5-haiku-20241022` entry SHALL have `oauthCompatible: false`

#### Scenario: Built-in model not in override table defaults to compatible
- **WHEN** a built-in model id is not present in the override table
- **THEN** its registry entry SHALL have `oauthCompatible: true` (or omitted, treated as `true`)

#### Scenario: Legacy `-latest` alias in the live catalog stays denied under OAuth
- **WHEN** the registry's live catalog contains `anthropic/claude-3-5-haiku-latest` (a pre-4.x alias) and only an Anthropic OAuth credential is configured
- **THEN** the override table SHALL flag it `oauthCompatible: false` and `/v1/models` SHALL NOT list it
- **NOTE** the override table is maintained against the registry's *live* catalog (the pi-ai copy the proxy resolves via the tool registry) — NOT a standalone `node_modules` enumeration; the two can differ. Verify entries via `GET /api/model-proxy/diagnostics`.

#### Scenario: Custom model can opt out via models.json
- **WHEN** a custom model entry in `~/.pi/agent/models.json` sets `"oauthCompatible": false`
- **THEN** the registry SHALL preserve that flag and the credential-routing filter SHALL exclude the model under OAuth-only credentials

### Requirement: Diagnostic surface for excluded models

The registry SHALL expose every known model — including ones excluded by the credential-routing filter — through a diagnostic accessor that annotates each entry with the reason it was excluded (or `null` when included).

The set of reason values SHALL be:
- `null` — model is included in `/v1/models`
- `"no-credential"` — provider has no credential of any kind
- `"oauth-incompatible"` — provider has only an OAuth credential and the model is flagged `oauthCompatible: false`

A new `GET /api/model-proxy/diagnostics` endpoint (added by this change) SHALL include the reason for each model when present. No such endpoint exists today.

#### Scenario: Diagnostic shows excluded reason for OAuth-incompatible model
- **WHEN** the user queries `/api/model-proxy/diagnostics` with only an Anthropic OAuth credential configured
- **THEN** the entry for `anthropic/claude-3-5-haiku-20241022` SHALL include `excludedReason: "oauth-incompatible"`

#### Scenario: Diagnostic shows null reason for included model
- **WHEN** the same diagnostic is queried for `anthropic/claude-haiku-4-5`
- **THEN** the entry SHALL include `excludedReason: null` (or omit the field)

#### Scenario: Diagnostic shows no-credential reason for unconfigured provider
- **WHEN** no credential is configured for `openai`
- **THEN** every `openai/*` entry SHALL include `excludedReason: "no-credential"`

