## MODIFIED Requirements

### Requirement: Native capability metadata SHALL win over discovery fallback

For a custom `provider/id` present in BOTH live `/v1/models` discovery and native
`models.json`, the server registry SHALL merge them at the field level: routing fields
(`baseUrl`, `api`, existence, `oauthCompatible`) SHALL come from discovery, and capability
fields (`contextWindow`, `maxTokens`, `reasoning`, `thinkingLevelMap`, `compat`, `input`,
`cost`) SHALL come from native `models.json` and SHALL override BOTH endpoint-advertised
values and the api-typed fallback floors. `oauthCompatible` SHALL NOT be overridden by
native `models.json` (the native format has no such field; it stays from
discovery/built-in `isOauthIncompatible` logic so the OAuth-incompat filter is not
bypassed). A native-only entry (no live discovery match — e.g. `/v1/models` unavailable or
IDs-only) SHALL still surface in the catalogue. Built-in pi-ai models SHALL retain
precedence over any custom `provider/id` and SHALL NOT be overridden by a custom
`models.json` entry authored under a built-in provider name.

Capability precedence for a custom `provider/id` SHALL be, per field, first hit wins:

1. native `~/.pi/agent/models.json`
2. endpoint-advertised metadata from the provider's model list
3. the name-matched catalog probe (in-session surface only)
4. api-typed fallback floors

#### Scenario: Native values override fallback floors

- **GIVEN** discovery returns `newapi/glm-5.2` with fallback ctx `128000` / maxTokens `16384` / `reasoning:false` / `input:["text"]` / zero `cost`
- **AND** native `models.json` declares `newapi/glm-5.2` with ctx `200000` / maxTokens `65536` / `reasoning:true`, a `thinkingLevelMap`, `input:["text","image"]`, and a non-zero `cost`
- **WHEN** the server builds its catalogue
- **THEN** the resulting `newapi/glm-5.2` SHALL report ctx `200000`, maxTokens `65536`, `reasoning:true`, the native `thinkingLevelMap`, the native `input`, and the native `cost`
- **AND** its `baseUrl`/`api`/`oauthCompatible` SHALL come from the discovered provider so the model-proxy can route it

#### Scenario: Native values override endpoint-advertised values

- **GIVEN** a provider advertising `newapi/glm-5.2` with ctx `200000` in its model list
- **AND** native `models.json` declares `newapi/glm-5.2` with ctx `1000000`
- **WHEN** the server builds its catalogue
- **THEN** `newapi/glm-5.2` SHALL report ctx `1000000`

#### Scenario: Native-only entry survives a discovery outage

- **GIVEN** `/v1/models` is unavailable (discovery returns no models for `newapi`)
- **AND** native `models.json` declares `newapi/glm-5.2`
- **WHEN** the server builds its catalogue
- **THEN** `newapi/glm-5.2` SHALL still be present with its native capability metadata
- **AND** its `baseUrl`/`api` SHALL be resolved from `providers.json#providers.newapi`

#### Scenario: Discovered model keeps fallback floors only where the endpoint was silent

- **GIVEN** discovery returns `newapi/other-model` and native `models.json` has no matching entry
- **AND** the provider advertised no capability fields for `newapi/other-model`
- **WHEN** the server builds its catalogue
- **THEN** `newapi/other-model` SHALL retain its api-typed fallback capability floors

#### Scenario: Discovered model prefers advertised values over floors

- **GIVEN** discovery returns `newapi/other-model` and native `models.json` has no matching entry
- **AND** the provider advertised ctx `1000000` and `reasoning: true` for it
- **WHEN** the server builds its catalogue
- **THEN** `newapi/other-model` SHALL report ctx `1000000` and `reasoning: true`
- **AND** SHALL NOT report the api-typed floors for those fields

### Requirement: GET /api/models SHALL project native capability metadata without credentials or compat

`GET /api/models` SHALL include the raw `thinkingLevelMap` for custom models that carry
it, alongside the existing `reasoning`, `input`, `contextWindow`, `maxTokens`, and `cost`
fields. The server SHALL NOT derive a `supportedThinkingLevels` list (agent consumers
interpret the raw map; the sole `supportedThinkingLevels` derivation lives in the bridge
extension). The response and any logs SHALL NOT include `apiKey` or other credential
material, and SHALL NOT include the raw `compat` object (carried on the registry model for
proxy request formatting only).

The response SHALL carry `metadataSource` for custom models, whose value domain is
`"catalog" | "endpoint" | "fallback"`.

#### Scenario: thinkingLevelMap reaches the introspection response

- **GIVEN** a custom model carrying a native `thinkingLevelMap`
- **WHEN** `GET /api/models` is served
- **THEN** the response entry SHALL include the raw `thinkingLevelMap`
- **AND** SHALL NOT include a server-derived `supportedThinkingLevels`

#### Scenario: compat is carried for routing but never serialized to /api/models

- **GIVEN** a custom model carrying a `compat` object used for proxy request formatting
- **WHEN** `GET /api/models` is served
- **THEN** the response entry SHALL NOT contain `compat`
- **AND** the registry model SHALL still carry it for routing

#### Scenario: metadataSource reports endpoint provenance

- **GIVEN** a custom model whose capability fields came from the provider's advertised metadata
- **WHEN** `GET /api/models` is served
- **THEN** its `metadataSource` SHALL be `"endpoint"`
