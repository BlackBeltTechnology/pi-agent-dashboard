# custom-provider-metadata-discovery Specification

## Purpose
Preserve model capability metadata that custom providers advertise in their `/v1/models` response, so discovered models surface real context windows, token limits, reasoning, and input modalities instead of api-typed fallback floors. Created by archiving change fix-custom-provider-model-metadata.

## Requirements
### Requirement: Custom-provider discovery SHALL preserve advertised model metadata

The dashboard SHALL provide a model-discovery function that returns, for each model a
custom provider advertises, a record carrying BOTH the model id AND every capability field
the provider advertised. Discovery SHALL NOT reduce the provider response to ids.

The existing ids-only helpers SHALL remain behaviourally unchanged: `extractModelIds`,
`listProviderModelIds`, and `probeProvider` keep their current signatures and return
values, so the provider settings "Test" button is unaffected.

Discovery SHALL degrade exactly as today on failure: a non-2xx response, unparseable body,
timeout, or unresolvable api key SHALL yield no models for that provider and SHALL NOT
throw, so one unreachable provider cannot break the catalogue.

Metadata SHALL be attached during discovery, before any registry cache is populated, so no
consumer observes a fallback value for a field the provider advertised. Satisfying this
requirement SHALL NOT add a network round-trip beyond the single `/v1/models` request
discovery already performs.

#### Scenario: Advertised metadata survives discovery

- **GIVEN** a custom provider whose `/v1/models` returns `{ data: [{ id: "cc/claude-opus-5", context_length: 1000000, max_completion_tokens: 128000, capabilities: { reasoning: true, vision: true } }] }`
- **WHEN** the dashboard discovers that provider's models
- **THEN** the discovered record for `cc/claude-opus-5` SHALL report contextWindow `1000000`, maxTokens `128000`, `reasoning: true`, and `input` including `"image"`
- **AND** no field SHALL hold the api-typed fallback value

#### Scenario: Ids-only helpers are unchanged

- **GIVEN** the same provider response
- **WHEN** `listProviderModelIds` and `probeProvider` are called
- **THEN** `listProviderModelIds` SHALL still return a `string[]` of ids
- **AND** `probeProvider` SHALL still return `{ ok, status, modelCount, sample }` with `sample` capped at 5 ids

#### Scenario: Unreachable provider yields no models and does not throw

- **GIVEN** a custom provider whose `/v1/models` returns HTTP 500, or times out, or returns a body that is not JSON
- **WHEN** metadata-preserving discovery runs for that provider
- **THEN** it SHALL return no models for that provider
- **AND** it SHALL NOT throw, and other providers SHALL still be discovered

### Requirement: Metadata mapping SHALL be keyed on response shape, not the configured api

Mapping SHALL be selected by the shape of the provider response body, NOT by the
provider's configured `api` value. A provider configured `api: "anthropic-messages"` that
returns an OpenAI-style `{ data: [...] }` body SHALL have its metadata mapped by the
OpenAI-ish rules. This mirrors `extractModelIds`, which already keys on `body.data` /
`body.models` independently of `api`.

From an OpenAI-ish body (`body.data[]`), the mapping SHALL read `context_length`,
`max_completion_tokens`, and the `capabilities` object's `reasoning`, `vision`, `tools`,
`contextWindow`, `maxOutput`, `thinkingFormat`, `thinkingCanDisable`, and `thinkingRange`.

From a Google-ish body (`body.models[]`), the mapping SHALL read `inputTokenLimit`,
`outputTokenLimit`, and `supportedGenerationMethods`.

When a top-level scalar and its `capabilities` twin are both present, the top-level scalar
SHALL win: `context_length` over `capabilities.contextWindow`, and
`max_completion_tokens` over `capabilities.maxOutput`.

`capabilities.vision: true` SHALL add `"image"` to `input`. Advertised modalities with no
representation in the `input` type (`pdf`, `audioInput`, `videoInput`, `imageOutput`,
`audioOutput`, `search`) SHALL be ignored and SHALL NOT widen the type.

#### Scenario: OpenAI-shaped body from an anthropic-messages provider is mapped

- **GIVEN** a provider configured `api: "anthropic-messages"`
- **AND** its `/v1/models` returns an OpenAI-style `{ data: [{ id, context_length: 1000000, capabilities: { reasoning: true } }] }` body
- **WHEN** discovery maps its metadata
- **THEN** the advertised `context_length` and `reasoning` SHALL be adopted
- **AND** the mapping SHALL NOT be skipped on account of the configured `api` value

#### Scenario: Google-shaped body is mapped

- **GIVEN** a provider whose model list returns `{ models: [{ name: "models/gemini-x", inputTokenLimit: 1048576, outputTokenLimit: 65536 }] }`
- **WHEN** discovery maps its metadata
- **THEN** `gemini-x` SHALL report contextWindow `1048576` and maxTokens `65536`

#### Scenario: Top-level scalar wins over its capabilities twin

- **GIVEN** a model advertising `context_length: 1000000` and `capabilities.contextWindow: 200000`
- **WHEN** discovery maps its metadata
- **THEN** the mapped contextWindow SHALL be `1000000`

#### Scenario: Unrepresentable modalities are dropped

- **GIVEN** a model advertising `capabilities: { vision: true, pdf: true, audioInput: true, search: true }`
- **WHEN** discovery maps its metadata
- **THEN** `input` SHALL be exactly `["text", "image"]`

### Requirement: Fallback floors SHALL apply per field, only where the provider was silent

Api-typed fallback floors SHALL be applied per field, only for fields the provider did not
advertise or advertised malformed. A model that advertises some fields and omits others
SHALL keep its advertised values AND receive floors only for the omitted ones. A model
advertising nothing SHALL be identical to today's behaviour.

A field SHALL be treated as not advertised when absent, `null`, of the wrong type, or —
for numeric capacity fields — not a finite number greater than zero.

#### Scenario: Partially-advertising model keeps advertised fields

- **GIVEN** a provider returning `{ id: "hybrid-model", capabilities: { reasoning: true } }` with no `context_length`
- **AND** the provider's api-typed floor is contextWindow `200000` / maxTokens `64000`
- **WHEN** discovery maps its metadata
- **THEN** `hybrid-model` SHALL report `reasoning: true` from the endpoint
- **AND** SHALL report contextWindow `200000` from the floor

#### Scenario: Silent model is unchanged from today

- **GIVEN** a provider returning `{ id: "bare-model" }` with no metadata fields at all
- **WHEN** discovery maps its metadata
- **THEN** `bare-model` SHALL carry the full api-typed floors for its provider's api

#### Scenario: Malformed advertised values are rejected in favour of floors

- **GIVEN** models advertising `context_length: "1000000"` (string), `context_length: 0`, `context_length: -5`, and `context_length: null`
- **WHEN** discovery maps their metadata
- **THEN** each SHALL fall back to the api-typed floor for that field
- **AND** discovery SHALL NOT throw

### Requirement: thinkingLevelMap SHALL be synthesized only when determined

`thinkingLevelMap` SHALL be synthesized only when the advertised thinking capability
determines it. When `thinkingFormat` is absent, or `thinkingRange` is `null` or otherwise
underdetermined, `thinkingLevelMap` SHALL be left ABSENT rather than guessed.

`reasoning: true` from the endpoint SHALL be adopted independently of
`thinkingLevelMap`, so thinking-level availability is restored by the `reasoning` flag
even when no map is synthesized.

A synthesized `thinkingLevelMap` SHALL NOT override a `thinkingLevelMap` declared for that
model in the user-authored `~/.pi/agent/models.json`.

#### Scenario: Underdetermined thinking capability yields no map

- **GIVEN** a model advertising `capabilities: { reasoning: true, thinkingFormat: "claude-adaptive", thinkingCanDisable: true, thinkingRange: null }`
- **WHEN** discovery maps its metadata
- **THEN** the model SHALL report `reasoning: true`
- **AND** `thinkingLevelMap` SHALL be absent

#### Scenario: Native declaration outranks synthesis

- **GIVEN** a model whose advertised thinking capability would determine a map
- **AND** `~/.pi/agent/models.json` declares a `thinkingLevelMap` for that same `provider/id`
- **WHEN** the catalogue is built
- **THEN** the native `thinkingLevelMap` SHALL be used

### Requirement: Endpoint-sourced metadata SHALL be distinguishable in provenance

`metadataSource` SHALL admit a third value, `"endpoint"`, alongside `"catalog"` and
`"fallback"`, so endpoint-confirmed metadata is neither mistaken for catalog-derived
metadata nor rendered as uncertain. A model whose fields come from more than one tier
SHALL be reported by its weakest adopted tier, so confirmed values are never presented as
uncertain and floor values are never presented as confirmed.

The model selector SHALL render `"endpoint"` provenance as confirmed capability, using its
existing "uncertain" treatment only for `"fallback"`.

#### Scenario: Fully-advertised model is marked endpoint

- **GIVEN** a model whose contextWindow, maxTokens, and reasoning all come from the provider response
- **WHEN** its metadata is projected
- **THEN** `metadataSource` SHALL be `"endpoint"`
- **AND** the selector SHALL NOT render its capabilities as uncertain

#### Scenario: Partially-advertised model reports its weakest tier

- **GIVEN** a model whose `reasoning` came from the endpoint and whose contextWindow came from the api-typed floor
- **WHEN** its metadata is projected
- **THEN** `metadataSource` SHALL be `"fallback"`

### Requirement: Both discovery surfaces SHALL surface advertised metadata

The dashboard has two independent custom-provider discovery surfaces: the server process
(`InternalRegistry` via `custom-provider-discovery.ts`) and the in-session bridge
extension (`provider-register.ts`). BOTH SHALL surface advertised metadata under the rules
above.

On the in-session surface, advertised metadata SHALL take precedence over the
name-matched catalog probe (`enrichModelMetadata`), which cannot resolve prefixed or
hybrid ids and can otherwise contradict what the provider actually serves. The catalog
probe SHALL remain the tier consulted for fields the provider did not advertise.

#### Scenario: Server surface reports advertised values

- **GIVEN** a custom provider advertising contextWindow `1000000` for `cc/claude-opus-5`
- **WHEN** `GET /api/models` is served
- **THEN** `cc/claude-opus-5` SHALL report contextWindow `1000000`

#### Scenario: In-session surface reports advertised values over the catalog guess

- **GIVEN** a custom provider advertising contextWindow `200000` for `ag/claude-opus-4-6-thinking`
- **AND** pi's catalog would resolve a name-matched `claude-opus-4-6` at contextWindow `1000000`
- **WHEN** the extension registers that provider and a session lists models
- **THEN** `ag/claude-opus-4-6-thinking` SHALL report contextWindow `200000` from the endpoint

#### Scenario: Catalog probe still fills unadvertised fields in-session

- **GIVEN** a custom-provider model that advertises no `context_length`
- **AND** pi's catalog has a match for its id
- **WHEN** the extension enriches that model
- **THEN** the catalog value SHALL be used for contextWindow

### Requirement: Built-in providers and credentials SHALL be unaffected

Metadata discovery SHALL apply only to providers defined in `providers.json#providers`.
Built-in pi-ai providers SHALL NOT be routed through it and SHALL retain their bundled
catalog metadata and existing precedence over custom `provider/id` entries.

No credential material SHALL enter the registry, the `/api/models` response, or any log
line as a result of preserving the provider response. The dashboard SHALL NOT write
`~/.pi/agent/models.json`.

#### Scenario: Built-in model metadata is untouched

- **GIVEN** a built-in provider model such as `anthropic/claude-opus-4-8`
- **WHEN** custom-provider metadata discovery runs
- **THEN** that model's metadata SHALL be identical to its value before this change

#### Scenario: Built-in still wins over a same-named custom entry

- **GIVEN** a custom provider advertising a model id that collides with a built-in `provider/id`
- **WHEN** the catalogue is built
- **THEN** the built-in pi-ai model SHALL retain precedence

#### Scenario: No credential leaks through preserved metadata

- **GIVEN** a provider whose response is preserved with full metadata
- **WHEN** `GET /api/models` is served and discovery logs are written
- **THEN** neither SHALL contain the provider's resolved api key
- **AND** the response SHALL NOT contain the raw `compat` object
