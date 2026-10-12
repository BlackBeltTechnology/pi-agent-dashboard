## MODIFIED Requirements

### Requirement: Credential-kind aware model filtering

The dashboard model proxy SHALL filter `/v1/models` and `find()` results by the *kind* of credential available for each model's provider, not only by provider presence.

The credential set a request is evaluated against SHALL be:
- for a request authenticated with a device proxy key issued by vault delivery: the credentials in `auth.json`, plus the credentials of the vault bindings that key covers, keyed by each binding's provider id (including clone ids);
- for every other request, including `/api/models` and the plugin model runtime: the credentials in `auth.json` only, as before. Provider ids that only vault bindings provide (clone ids, pool members, vault-backed accounts) SHALL have no credential outside a device-proxy request.

For each model, the system SHALL include it in the available set only when at least one credential for its provider, in that credential set, can route it:

- An `api_key` credential, or a vault `key` binding, with a non-empty key SHALL be considered able to route every model of that provider.
- An `oauth` credential with a non-empty `access` or `refresh` token, or a vault `oauth` binding, SHALL be considered able to route a model only when that model's `oauthCompatible` flag is `true` (default) or absent. A clone provider id SHALL use the flags of the base provider its binding explicitly declares.
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

#### Scenario: Device proxy key sees its vault bindings
- **WHEN** a request carries a device proxy key covering vault binding `anthropic-work` (an `oauth` clone of `anthropic`), and `auth.json` has no `anthropic-work` entry
- **THEN** `/v1/models` SHALL list the `anthropic-work` models whose base `anthropic` models are `oauthCompatible`

#### Scenario: Other callers do not see vault bindings
- **WHEN** a request without a device proxy key lists `/v1/models`, or `/api/models` is requested, and the vault holds a proxy binding `anthropic-work`
- **THEN** no `anthropic-work/*` model SHALL appear
