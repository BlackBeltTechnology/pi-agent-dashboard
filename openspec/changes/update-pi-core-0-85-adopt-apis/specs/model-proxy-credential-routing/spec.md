## ADDED Requirements

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
