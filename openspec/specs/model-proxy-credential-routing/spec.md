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

### Requirement: OAuth token refresh SHALL propagate a concrete abort signal

pi 0.84.1 requires config-form extension OAuth `refreshToken(credentials, signal)` callbacks to accept and honor a concrete abort signal. The dashboard's internal auth storage SHALL pass a real `AbortSignal` on every OAuth refresh it initiates, and SHALL NOT call the callback with the credentials argument alone.

#### Scenario: Refresh is invoked with a signal

- **WHEN** the internal auth storage refreshes an OAuth credential
- **THEN** it SHALL pass a concrete `AbortSignal` as the second argument to `refreshToken`

#### Scenario: Aborted refresh stops cleanly

- **WHEN** the supplied signal aborts while an OAuth refresh is in flight
- **THEN** the refresh SHALL stop
- **AND** no partially-refreshed credential SHALL be persisted

#### Scenario: Refresh failure does not persist a broken credential

- **WHEN** an OAuth refresh rejects
- **THEN** the previously stored credential SHALL be left intact
- **AND** the failure SHALL be surfaced to the caller rather than silently swallowed

### Requirement: A newly catalogued subscription model SHALL be reachable without a provider-key remap

The credential-kind filter matches a model to a credential by the model's `provider` field against the auth-key under which the credential is stored. Where the upstream catalog publishes a model once per subscription channel — carrying the subscription-specific provider id on the entry itself — no remap is required, and the dashboard SHALL NOT introduce one. The dashboard SHALL verify reachability from the catalog rather than assume it, and SHALL NOT add prefix-, substring-, or heuristic-based provider matching to the filter.

A remap SHALL be introduced only if a future catalog publishes a model whose `provider` differs from every auth-key that can route it, and then only as an explicit enumerated mapping.

#### Scenario: Subscription-catalogued model is listed for its subscription credential

- **GIVEN** `~/.pi/agent/auth.json` holds only an OAuth credential under the `openai-codex` auth key
- **AND** the registry contains a model entry whose `provider` is `openai-codex`
- **WHEN** `/v1/models` is queried
- **THEN** that model SHALL be listed
- **AND** `find("openai-codex", <id>)` SHALL return its entry

#### Scenario: The same model id under a different provider is filtered independently

- **GIVEN** the catalog publishes the same model id under more than one provider (for example an API-key provider and a subscription provider)
- **AND** a credential exists for only one of those providers
- **WHEN** `/v1/models` is queried
- **THEN** only the entry whose `provider` has a credential SHALL be listed
- **AND** the credential SHALL NOT be used to route the other provider's entry

#### Scenario: No heuristic provider matching is introduced

- **GIVEN** an auth key and a model provider that are not equal
- **WHEN** the credential-kind filter evaluates the model
- **THEN** the model SHALL be excluded unless an explicit enumerated mapping pairs the two
- **AND** no prefix or substring match SHALL be used to bridge them

### Requirement: A provider gate enforced by upstream client-version headers SHALL NOT be modelled as an OAuth incompatibility

Where an upstream provider rejects a model for a subscription credential because of the client-version headers the runtime sends — rather than because the model is unavailable to subscription credentials at all — the dashboard SHALL NOT add that model to the per-provider OAuth-incompatibility list. The `oauthCompatible` flag SHALL remain reserved for models that genuinely cannot be routed by an OAuth credential. A client-version rejection SHALL be resolved by moving the pinned runtime, and the dashboard SHALL NOT construct or override client-version headers itself.

#### Scenario: Version-gated model is not added to the incompatibility list

- **GIVEN** an upstream model that returns a client-version-too-old rejection under the previously pinned runtime
- **AND** the same model succeeds with the newly pinned runtime and the same credential
- **WHEN** the OAuth-compatibility list is evaluated
- **THEN** that model SHALL NOT be flagged `oauthCompatible: false`
- **AND** it SHALL appear in `/v1/models` for an OAuth-only credential

#### Scenario: Dashboard does not set client-version headers

- **WHEN** the model proxy issues an upstream request on behalf of a subscription credential
- **THEN** it SHALL NOT set or override the client-version or client user-agent headers
- **AND** those headers SHALL be whatever the pinned runtime constructs
