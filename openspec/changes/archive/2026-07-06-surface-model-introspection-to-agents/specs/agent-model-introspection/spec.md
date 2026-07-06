# agent-model-introspection Specification

## ADDED Requirements

### Requirement: Ungated model catalogue endpoint

The dashboard server SHALL expose `GET /api/models` returning the reachability-filtered model catalogue without requiring a `pi-proxy-...` Bearer key. The endpoint SHALL be subject only to the dashboard's own auth gate (identical posture to `GET /api/provider-auth/status`).

#### Scenario: Catalogue returned without a proxy key

- **GIVEN** the dashboard server is running
- **AND** no `Authorization: Bearer pi-proxy-...` header is supplied
- **WHEN** a client GETs `/api/models`
- **THEN** the response status is `200`
- **AND** the body lists the same models `ModelRegistry.getAvailable()` returns
- **AND** each row contains `id` (`provider/modelId`), `provider`, and available capability metadata (`reasoning`, `input`, `contextWindow`, `maxTokens`, `cost`) when known

#### Scenario: Reachability filtering preserved

- **GIVEN** a model whose provider has no configured credentials
- **WHEN** `GET /api/models` is called without `annotated`
- **THEN** that model is NOT present in the response
- **AND** `getAvailable()` semantics are preserved end-to-end

### Requirement: Annotated mode exposes exclusion reasons

`GET /api/models?annotated=1` SHALL return every known model — including unreachable ones — each carrying an `excludedReason` of `no-credential` or `oauth-incompatible` when it is excluded from the reachable set, sourced from `InternalRegistry.getAllAnnotated()`.

#### Scenario: Unreachable model reports why

- **GIVEN** at least one provider without configured credentials exists in the catalogue
- **WHEN** `GET /api/models?annotated=1` is called
- **THEN** the response includes that provider's models
- **AND** each such model carries `excludedReason: "no-credential"`

#### Scenario: OAuth-incompatible model reports why

- **GIVEN** a built-in model flagged OAuth-incompatible (per the maintained override table)
- **AND** the provider is authed only via OAuth
- **WHEN** `GET /api/models?annotated=1` is called
- **THEN** that model carries `excludedReason: "oauth-incompatible"`

### Requirement: No credential material in responses

Neither `GET /api/models` nor its annotated mode SHALL include API keys, OAuth tokens, or any other credential material. Only model identity, provider identity, capability, and cost metadata are exposed.

#### Scenario: Response carries no secrets

- **GIVEN** authed providers exist (API key and/or OAuth)
- **WHEN** `GET /api/models[?annotated=1]` is called
- **THEN** no field in any row contains an API key, bearer token, or OAuth credential

### Requirement: Skill points agents at the endpoint

The shipped `pi-dashboard` skill SHALL provide a `dashboard-list-models` command that calls `GET /api/models[?annotated=1]` and instructs agents not to parse `~/.pi/agent/providers.json` or `~/.pi/agent/models.json` for model inventory.

#### Scenario: List command returns catalogue

- **GIVEN** the dashboard is running
- **WHEN** an agent invokes the `dashboard-list-models` command
- **THEN** it retrieves the model catalogue via `GET /api/models`
- **AND** the command guidance names the file-parse approach as incorrect
