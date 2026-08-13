## ADDED Requirements

### Requirement: Default Model options are the union of the server catalogue and session models

The Settings panel SHALL source the Default Model selector's options from the union of:

1. the server's session-independent model catalogue, fetched from `GET /api/models` without the
   `annotated` query parameter, and
2. every per-session `models_list` the client holds.

The union SHALL be deduplicated by fully-qualified `"provider/id"`. When the same
`"provider/id"` is present in both, the **session-supplied entry SHALL be used**, because it
carries display name and capability-confidence fields the catalogue rows do not.

The selector SHALL be fully usable when no pi session is connected, in which case the union is
the catalogue alone.

#### Scenario: Selector is populated with zero live sessions
- **GIVEN** no pi session is connected to the dashboard
- **AND** `GET /api/models` returns a non-empty catalogue
- **WHEN** the user opens Settings and views the Default Model control
- **THEN** the selector SHALL list every model from the catalogue
- **AND** the user SHALL be able to select one and save it as `defaultModel`

#### Scenario: Union is a superset of the session-only list
- **GIVEN** `GET /api/models` returns model A
- **AND** the only connected session pushed a `models_list` containing model B
- **WHEN** the Default Model selector is rendered
- **THEN** it SHALL list both A and B

#### Scenario: Session entry wins on collision
- **GIVEN** `GET /api/models` returns a row for `openai/gpt-5` with no `name`
- **AND** a connected session pushed a `models_list` entry for `openai/gpt-5` with `name` `"GPT-5"` and `metadataSource` `"catalog"`
- **WHEN** the Default Model selector is rendered
- **THEN** exactly one `openai/gpt-5` option SHALL be listed
- **AND** that option SHALL carry `name` `"GPT-5"` and `metadataSource` `"catalog"`

#### Scenario: Env-credentialed models remain reachable
- **GIVEN** a provider whose credential exists only as an environment variable, so `GET /api/models` does not list its models
- **AND** a connected session pushed a `models_list` containing those models
- **WHEN** the Default Model selector is rendered
- **THEN** those models SHALL be listed

### Requirement: Model proxy editors are sourced from the catalogue alone

The Settings panel SHALL supply `ModelProxySection` — its preferred-models editor, model-aliases
editor, and availability indicators — with the `GET /api/models` catalogue **only**, not the
union defined above. These controls configure what the model proxy routes, and the catalogue is
the proxy's routable set by construction.

#### Scenario: Proxy editors exclude a session-only model
- **GIVEN** a model is present in a session's `models_list` but absent from `GET /api/models`
- **WHEN** the model proxy preferred-models and aliases editors are rendered
- **THEN** that model SHALL NOT be offered
- **AND** the Default Model selector SHALL still offer it

#### Scenario: Proxy editors are populated with zero live sessions
- **GIVEN** no pi session is connected
- **AND** `GET /api/models` returns a non-empty catalogue
- **WHEN** the model proxy editors are rendered
- **THEN** they SHALL offer every model from the catalogue

### Requirement: Catalogue rows are projected by a single shared pure mapper

Catalogue rows SHALL be projected to the client `ModelInfo` shape by one shared pure mapper,
which SHALL:

- take `provider` from the row's own `provider` field, and derive the bare `id` by stripping the
  leading `"<provider>/"` prefix from the row's `id` — it SHALL NOT determine the provider by
  splitting the row id;
- set `vision` to `input?.includes("image")`, preserving `undefined` when the row carries no
  `input` (the route omits `input` when falsy), and SHALL NOT throw on such a row;
- pass `reasoning` and `contextWindow` through unchanged;
- **omit** `metadataSource`, because the wire row does not distinguish authored capabilities from
  registry-floored defaults;
- drop `thinkingLevelMap`, `maxTokens`, and `cost`, and SHALL NOT derive `supportedThinkingLevels`.

#### Scenario: Full row projection
- **GIVEN** a catalogue row `{ id: "openai/gpt-5", provider: "openai", reasoning: true, input: ["text","image"], contextWindow: 400000, maxTokens: 128000, thinkingLevelMap: {...}, cost: {...} }`
- **WHEN** the row is mapped
- **THEN** the result SHALL be `{ provider: "openai", id: "gpt-5", reasoning: true, vision: true, contextWindow: 400000 }`
- **AND** the result SHALL NOT carry `metadataSource`, `supportedThinkingLevels`, `thinkingLevelMap`, `maxTokens`, or `cost`

#### Scenario: Row with no input field does not throw
- **GIVEN** a catalogue row that carries no `input` property
- **WHEN** the row is mapped
- **THEN** the mapper SHALL return a result whose `vision` is `undefined`
- **AND** it SHALL NOT throw

#### Scenario: Text-only model maps to vision false
- **GIVEN** a catalogue row whose `input` is `["text"]`
- **WHEN** the row is mapped
- **THEN** `vision` SHALL be `false`

#### Scenario: Model id containing a slash
- **GIVEN** a catalogue row with `provider` `"openrouter"` and `id` `"openrouter/meta-llama/llama-3-70b"`
- **WHEN** the row is mapped
- **THEN** `provider` SHALL be `"openrouter"` and `id` SHALL be `"meta-llama/llama-3-70b"`

#### Scenario: Provider name containing a slash
- **GIVEN** a catalogue row with `provider` `"my/proxy"` and `id` `"my/proxy/some-model"`
- **WHEN** the row is mapped
- **THEN** `provider` SHALL be `"my/proxy"` and `id` SHALL be `"some-model"`

### Requirement: Catalogue refetches after a credential change made from Settings

The Settings panel SHALL own an explicit catalogue-refetch action and SHALL invoke it after each
of the following succeeds: an API-key save, a custom-provider save or removal, and an OAuth or
device-code authorization completion. Invoking it SHALL re-issue `GET /api/models` and re-render
both the Default Model selector and the model proxy editors, without a page reload, a server
restart, or any connected pi session.

Because the server's registry refresh is asynchronous and not awaited by those endpoints, a
refetch MAY observe the pre-refresh catalogue. The refetch SHALL therefore be triggered by the
originating request's success response and SHALL NOT be implemented as a fixed delay.

#### Scenario: Saving an API key surfaces its models with no session connected
- **GIVEN** no pi session is connected
- **AND** the Default Model selector lists no models of provider `P`
- **WHEN** the user saves an API key for provider `P` and the request succeeds
- **THEN** the panel SHALL issue a new `GET /api/models`
- **AND** the selector SHALL list provider `P`'s models once that response reflects the credential

#### Scenario: OAuth completion refetches the catalogue
- **GIVEN** the user completes an OAuth or device-code authorization for provider `P` from Settings
- **WHEN** the authorization completes successfully
- **THEN** the panel SHALL issue a new `GET /api/models`

#### Scenario: Removing a provider drops its models
- **GIVEN** the Default Model selector lists models of custom provider `Q`
- **WHEN** the user removes provider `Q` and the save succeeds
- **THEN** the panel SHALL refetch the catalogue
- **AND** provider `Q`'s models SHALL NOT be listed, unless a live session still reports them

#### Scenario: Refetch is not a timed guess
- **WHEN** the panel refetches after a credential write
- **THEN** the refetch SHALL be triggered by that write's success response
- **AND** it SHALL NOT be triggered by a fixed delay

### Requirement: Catalogue fetch has a loading state, a bounded timeout, and a defined concurrency rule

The Settings panel SHALL render an explicit loading state for the Default Model control while a
catalogue request is in flight. The loading state SHALL be distinguishable from both a resolved
empty catalogue and the catalogue-unavailable callout.

The catalogue request SHALL be bounded by a client timeout of 10 seconds. On expiry the panel
SHALL render the catalogue-unavailable callout rather than remaining in the loading state
indefinitely.

When more than one catalogue request is in flight, the panel SHALL apply **last-response-wins**:
the most recently received response replaces the rendered catalogue, regardless of request order.
A stale response MAY therefore transiently replace fresher data; this is corrected by the next
refetch and SHALL NOT be treated as a defect.

#### Scenario: Loading state on a cold first fetch
- **GIVEN** the Settings panel has issued `GET /api/models` and no response has arrived
- **WHEN** the Default Model control is rendered
- **THEN** a loading state SHALL be shown
- **AND** neither the empty state nor the catalogue-unavailable callout SHALL be shown

#### Scenario: Loading state clears on success
- **GIVEN** the Default Model control is in its loading state
- **WHEN** `GET /api/models` responds `200` with a non-empty list
- **THEN** the loading state SHALL be replaced by the model options

#### Scenario: Hung request times out into the unavailable callout
- **GIVEN** `GET /api/models` has not responded
- **WHEN** 10 seconds elapse since the request was issued
- **THEN** the catalogue-unavailable callout SHALL be shown
- **AND** the loading state SHALL NOT persist

#### Scenario: Out-of-order responses resolve last-response-wins
- **GIVEN** refetch R1 is issued, then refetch R2 is issued
- **WHEN** R2's response arrives first and R1's response arrives second
- **THEN** the rendered catalogue SHALL be the one carried by R1's response

### Requirement: Catalogue-unavailable renders as a callout beside the Default Model control

When the catalogue request fails — `503` with code `MODEL_PROXY_RUNTIME_MISSING`, any other
non-2xx status, or a network failure — the Settings panel SHALL render an explicit callout
adjacent to the Default Model control stating that the model catalogue could not be loaded. The
callout SHALL be rendered by the Settings panel itself and SHALL NOT require the model selector
popover to be openable.

A successful response carrying an empty list SHALL NOT render this callout.

#### Scenario: pi-ai unresolvable
- **GIVEN** `GET /api/models` responds `503 { code: "MODEL_PROXY_RUNTIME_MISSING" }`
- **WHEN** the Sessions settings page is rendered
- **THEN** a catalogue-unavailable callout SHALL be shown beside the Default Model control

#### Scenario: Network failure is also surfaced
- **GIVEN** `GET /api/models` fails with a network error
- **WHEN** the Sessions settings page is rendered
- **THEN** the catalogue-unavailable callout SHALL be shown

#### Scenario: Empty catalogue is not an error
- **GIVEN** `GET /api/models` responds `200` with an empty `data` array
- **WHEN** the Sessions settings page is rendered
- **THEN** the catalogue-unavailable callout SHALL NOT be shown

#### Scenario: Session models still offered when the catalogue is unavailable
- **GIVEN** `GET /api/models` fails
- **AND** a connected session pushed a non-empty `models_list`
- **WHEN** the Default Model selector is rendered
- **THEN** it SHALL still offer that session's models

## MODIFIED Requirements

### Requirement: Provider save refreshes available models
When LLM providers are saved via the Settings panel, the server SHALL broadcast a `credentials_updated` message to all connected pi sessions. This MUST cause the model registry to refresh and push updated `models_list` messages back to the dashboard client, keeping every session-scoped model selector current.

The Settings panel's **Default Model** selector SHALL NOT depend on that broadcast for its own correctness. It is sourced from the union of the session-independent `GET /api/models` catalogue and the per-session model lists, and the catalogue half is refreshed by the panel's own refetch, so the selector SHALL display the updated model list without requiring a server restart **and without requiring any connected pi session**.

#### Scenario: Saving new provider populates session model selectors
- **WHEN** the user adds a new LLM provider and clicks Save
- **THEN** the server broadcasts `credentials_updated` to all sessions
- **AND** each session's bridge refreshes its model registry
- **AND** each session-scoped model selector shows models from the new provider

#### Scenario: Saving new provider populates the Default Model selector
- **WHEN** the user adds a new LLM provider and clicks Save
- **THEN** the Settings panel refetches `GET /api/models`
- **AND** the Default Model selector shows models from the new provider
- **AND** this holds whether or not any pi session is connected

#### Scenario: Removing a provider updates model selectors
- **WHEN** the user removes an LLM provider and clicks Save
- **THEN** models from the removed provider no longer appear in the Default Model selector, unless a live session still reports them
- **AND** they no longer appear in session-scoped selectors once each bridge has refreshed

#### Scenario: Models available immediately after save
- **WHEN** the user saves provider changes and opens the Default Model selector
- **THEN** models from all configured providers are listed
- **AND** no server restart is required
