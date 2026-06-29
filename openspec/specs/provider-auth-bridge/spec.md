# provider-auth-bridge Specification

## Purpose
Bridge-side contract for surfacing pi's `ModelRegistry` credential state to the dashboard server: pushes `models_list` + `providers_list` over WebSocket, hot-reloads `~/.pi/agent/providers.json` on `credentials_updated`, captures `ctx.modelRegistry` from `session_start` to enrich custom-provider model metadata, and tracks bridge-registered custom providers via `lastRegistered` so the consumer-side filter (`provider-auth-storage._buildAuthStatus`) can suppress their API-key rows from the Settings UI.
## Requirements
### Requirement: Credentials updated protocol message
The shared protocol SHALL define a `credentials_updated` message type in the `ServerToExtensionMessage` union. The message SHALL contain `{ type: "credentials_updated" }` with no additional payload.

#### Scenario: Message type definition
- **WHEN** the protocol types are compiled
- **THEN** `CredentialsUpdatedMessage` SHALL be a valid `ServerToExtensionMessage` variant with `type: "credentials_updated"`

### Requirement: Bridge handles credentials_updated
When the bridge extension receives a `credentials_updated` message from the server, it SHALL call `authStorage.reload()` on the cached `modelRegistry.authStorage` to force pi to re-read `auth.json` from disk.

#### Scenario: Credential reload on notification
- **WHEN** the bridge receives `{ type: "credentials_updated" }` and `modelRegistry.authStorage` is available
- **THEN** the bridge SHALL call `authStorage.reload()` so the pi session picks up updated credentials

#### Scenario: No modelRegistry available
- **WHEN** the bridge receives `credentials_updated` but `modelRegistry` has not been captured yet (session not started)
- **THEN** the bridge SHALL ignore the message without error

### Requirement: Custom-provider models default to image-capable

When the bridge extension registers a custom provider via `pi.registerProvider(...)` in `registerEntry()` (packages/extension/src/provider-register.ts), every model synthesized from the upstream `/v1/models` discovery response SHALL be declared with `input: ["text", "image"]` as its default capability. This default SHALL apply uniformly regardless of the model id, the provider's `api` field, or any upstream metadata. The default SHALL NOT apply to built-in or OAuth providers whose capabilities come from pi-ai's bundled `models.generated.js`.

#### Scenario: Default capability on fresh provider registration
- **WHEN** `registerEntry()` discovers a model from the upstream `/v1/models` endpoint
- **AND** the provider entry in `providers.json` does not explicitly override the model's capabilities
- **THEN** the synthesized model descriptor passed to `pi.registerProvider(...)` SHALL have `input: ["text", "image"]`

#### Scenario: Image-bearing prompt reaches vision-capable custom-provider model
- **WHEN** a user submits a prompt containing an image targeting a custom-provider model registered with `input: ["text", "image"]`
- **THEN** pi-ai's `downgradeUnsupportedImages` in `providers/transform-messages.js` SHALL NOT replace the image with the `"(image omitted: model does not support images)"` placeholder
- **AND** the image block SHALL be serialized into the outbound HTTP request by the provider-specific serializer (`openai-completions`, `anthropic-messages`, or `google-generative-ai`)

#### Scenario: Image-bearing prompt to text-only custom-provider model — graceful upstream handling
- **WHEN** a user submits a prompt containing an image targeting a custom-provider model that does not actually support vision
- **AND** the upstream returns HTTP 200 (silently ignoring the image or acknowledging its absence in the reply text)
- **THEN** the dashboard SHALL surface the model's response verbatim without injecting a client-side placeholder
- **AND** the turn SHALL complete normally

#### Scenario: Image-bearing prompt to text-only custom-provider model — hard upstream rejection
- **WHEN** a user submits a prompt containing an image targeting a custom-provider model that does not actually support vision
- **AND** the upstream returns HTTP 400 rejecting the image payload
- **THEN** the dashboard SHALL surface the upstream error message verbatim through the existing error-display path
- **AND** the turn SHALL end with an error status

#### Scenario: Built-in / OAuth providers unchanged
- **WHEN** pi loads a built-in or OAuth-authenticated provider (Anthropic, OpenAI Codex, GitHub Copilot, Gemini CLI, Antigravity)
- **THEN** the provider's models SHALL retain their `input` capability from pi-ai's `models.generated.js`
- **AND** this change SHALL NOT alter the capability of any built-in model

### Requirement: Bridge hot-reloads providers.json on credentials_updated
When the bridge extension receives a `credentials_updated` message, it SHALL re-read `~/.pi/agent/providers.json`, diff it against the last-registered provider snapshot, and call `pi.registerProvider(...)` for new or changed entries and `pi.unregisterProvider(...)` for removed entries — BEFORE invoking `modelRegistry.refresh()`. This ensures the model registry's subsequent refresh observes the newly-registered providers.

#### Scenario: New provider added to providers.json
- **WHEN** a new `{ name, baseUrl, apiKey, api }` entry is added to `~/.pi/agent/providers.json`
- **AND** the server broadcasts `{ type: "credentials_updated" }`
- **THEN** the bridge SHALL call `pi.registerProvider(name, ...)` with models discovered from the provider's `/v1/models` endpoint (or an empty models list if discovery fails)
- **AND** the subsequent `modelRegistry.refresh()` SHALL include the new provider's models in `getAvailable()`

#### Scenario: Existing provider removed from providers.json
- **WHEN** an existing entry is removed from `~/.pi/agent/providers.json`
- **AND** the server broadcasts `{ type: "credentials_updated" }`
- **THEN** the bridge SHALL call `pi.unregisterProvider(name)` for the removed entry
- **AND** that provider's models SHALL NOT appear in `modelRegistry.getAvailable()` after refresh

#### Scenario: Existing provider edited in providers.json
- **WHEN** an existing entry's `baseUrl`, `apiKey`, or `api` field changes in `~/.pi/agent/providers.json`
- **AND** the server broadcasts `{ type: "credentials_updated" }`
- **THEN** the bridge SHALL call `pi.unregisterProvider(name)` then `pi.registerProvider(name, ...)` with the new configuration
- **AND** async model discovery SHALL use the new `baseUrl` / `apiKey`

#### Scenario: Async model discovery completes after registration
- **WHEN** `pi.registerProvider(...)` is called during hot-reload
- **AND** the provider's async `/v1/models` discovery completes
- **THEN** the existing `onProviderChanged` callback SHALL fire
- **AND** the bridge SHALL send an updated `models_list` message for the current session so the dashboard browser client refreshes its model selector

#### Scenario: providers.json unchanged between credentials_updated events
- **WHEN** `credentials_updated` is received
- **AND** `~/.pi/agent/providers.json` has not changed since the last hot-reload
- **THEN** the bridge SHALL NOT call `pi.registerProvider` or `pi.unregisterProvider` for any entry
- **AND** `modelRegistry.refresh()` SHALL still be invoked to handle non-provider credential changes (e.g. OAuth)

#### Scenario: providers.json read fails
- **WHEN** reading `~/.pi/agent/providers.json` throws (missing file, parse error, IO error)
- **THEN** the bridge SHALL log the error via `console.error` with a `[dashboard]` prefix
- **AND** SHALL still invoke `modelRegistry.refresh()` so other credential updates are not blocked

### Requirement: Model metadata enriched via pi's model registry

When the bridge extension's `registerEntry()` function synthesizes a model descriptor for `pi.registerProvider(...)`, it SHALL resolve `contextWindow`, `maxTokens`, `reasoning`, `cost`, and `input` via a pure helper `enrichModelMetadata(discoveredId, api, probe)` that consults pi's `ModelRegistry.find(provider, id)` API through an injected probe. The probe SHALL be built from a module-level `modelRegistryRef` that is captured from `ctx.modelRegistry` in the first `session_start` event handler (and as a fallback, `model_select`) the extension receives. Because `activate()` fires before any event handler, the first registration pass MAY use fallback defaults; the `session_start` handler SHALL trigger an idempotent re-registration pass once `ctx.modelRegistry` is available, overwriting fallback entries with enriched metadata. When no `session_start` handler has yet fired (e.g., in isolated unit tests), the probe SHALL be `null` and the helper SHALL fall through to api-appropriate fallback defaults.

The helper SHALL strip common proxy-prefix path segments before registry lookup so that prefixed ids (e.g., `cc/claude-opus-4-7`, `anthropic/claude-opus-4-7`, `openrouter/anthropic/claude-opus-4-7`) resolve to the same registry entry as the bare id (`claude-opus-4-7`). Specifically, the helper SHALL try the full discovered id first, then the segment after the last `/` if any — in a deduplicated list.

Registry probing SHALL iterate a fixed api-appropriate candidate-provider list in preference order, returning the first match. The helper SHALL tolerate probes that throw by catching the exception and continuing to the next candidate.

The helper SHALL NOT import `@mariozechner/pi-ai` directly; it SHALL consume only the probe function passed as its third argument, which makes it fully unit-testable with a fake probe built from a `Map`.

#### Scenario: Prefixed Anthropic id resolves through anthropic-messages api

- **WHEN** `enrichModelMetadata("cc/claude-opus-4-7", "anthropic-messages", probe)` is called
- **AND** `probe("anthropic", "claude-opus-4-7")` returns the catalog entry for Opus 4.7 (1M ctx, 128k maxTok, reasoning, Opus cost)
- **THEN** the helper SHALL return `{ contextWindow: 1_000_000, maxTokens: 128_000, reasoning: true, cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 }, input: ["text","image"] }` (or whatever `input` the registry declared)

#### Scenario: Unprefixed registry-known id resolves

- **WHEN** `enrichModelMetadata("claude-sonnet-4-6", "anthropic-messages", probe)` is called
- **AND** `probe("anthropic", "claude-sonnet-4-6")` returns the catalog entry for Sonnet 4.6
- **THEN** the helper SHALL return the registry's full metadata including `contextWindow: 1_000_000`

#### Scenario: Three-segment proxy prefix resolves via last-segment fallback

- **WHEN** `enrichModelMetadata("openrouter/openai/gpt-5", "openai-completions", probe)` is called
- **AND** no candidate provider returns a match for the full id `"openrouter/openai/gpt-5"`
- **AND** `probe("openai", "gpt-5")` returns a non-null entry
- **THEN** the helper SHALL return that entry's metadata

#### Scenario: Candidate-provider probe order is deterministic for anthropic-messages

- **WHEN** the helper probes the registry for `anthropic-messages`
- **THEN** it SHALL try providers in the order `["anthropic", "opencode"]`
- **AND** it SHALL return the first match encountered
- **AND** it SHALL NOT consult any other provider once a match is found

#### Scenario: Candidate-provider probe order for google-generative-ai

- **WHEN** the helper probes the registry for `google-generative-ai`
- **THEN** it SHALL try providers in the order `["google", "google-vertex"]`

#### Scenario: Candidate-provider probe order for openai-completions

- **WHEN** the helper probes the registry for `openai-completions`
- **THEN** it SHALL try providers in the order `["openai", "openrouter", "groq", "xai", "mistral"]`

#### Scenario: Probe that throws is tolerated

- **WHEN** the helper's probe throws on one candidate
- **THEN** the helper SHALL catch the exception and continue with the next candidate-provider / id combination
- **AND** if no other combination matches, the helper SHALL return the api-appropriate fallback

#### Scenario: No probe supplied falls back to api-appropriate defaults

- **WHEN** `enrichModelMetadata("cc/claude-opus-4-7", "anthropic-messages")` is called without a probe argument (or with `null`)
- **THEN** the helper SHALL return `{ contextWindow: 200_000, maxTokens: 64_000, reasoning: false, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, input: ["text","image"] }`

#### Scenario: Registry miss falls back to api-appropriate defaults (anthropic-messages)

- **WHEN** `enrichModelMetadata("some-unknown-anthropic-model", "anthropic-messages", probe)` is called
- **AND** no candidate provider × id combination returns a match
- **THEN** the helper SHALL return `{ contextWindow: 200_000, maxTokens: 64_000, reasoning: false, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, input: ["text","image"] }`

#### Scenario: Registry miss falls back to api-appropriate defaults (openai-completions)

- **WHEN** `enrichModelMetadata("some-unknown-openai-model", "openai-completions", probe)` is called
- **AND** no candidate provider × id combination returns a match
- **THEN** the helper SHALL return `{ contextWindow: 128_000, maxTokens: 16_384, reasoning: false, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, input: ["text","image"] }`

#### Scenario: Registry miss falls back to api-appropriate defaults (google-generative-ai)

- **WHEN** `enrichModelMetadata("some-unknown-gemini-model", "google-generative-ai", probe)` is called
- **AND** no candidate provider × id combination returns a match
- **THEN** the helper SHALL return `{ contextWindow: 1_000_000, maxTokens: 65_536, reasoning: false, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, input: ["text","image"] }`

#### Scenario: Prefixed id with registry miss still falls back correctly

- **WHEN** `enrichModelMetadata("minimax/custom-private-model", "openai-completions", probe)` is called
- **AND** neither the full id `minimax/custom-private-model` nor the bare id `custom-private-model` matches any candidate
- **THEN** the helper SHALL return the openai-completions fallback defaults

#### Scenario: Unknown api value is treated as openai-completions

- **WHEN** `enrichModelMetadata("some-id", "unrecognized-api", probe)` is called
- **THEN** the helper SHALL probe the openai-completions candidate list and SHALL use the openai-completions fallback on miss

### Requirement: registerEntry wires modelRegistry into enrichModelMetadata

`registerEntry()` in `packages/extension/src/provider-register.ts` SHALL obtain a probe function by reading a module-level `modelRegistryRef` captured earlier from any pi event handler's `ctx.modelRegistry`. When the registry is available and exposes a `find` method, the probe SHALL be `(provider, id) => registry.find(provider, id) ?? null`. Otherwise the probe SHALL be `null`.

`registerEntry()` SHALL then call `enrichModelMetadata(m.id, entry.api, probe)` for every discovered model id and SHALL spread the returned `{ contextWindow, maxTokens, reasoning, cost, input }` verbatim into the synthesized model descriptor passed to `pi.registerProvider(...)`. The existing behavior of using the bare discovered id as `id` and `name` SHALL be preserved.

The extension's `session_start` handler SHALL capture `ctx.modelRegistry` into `modelRegistryRef` (if not yet set) and SHALL re-register every previously-registered provider so their model metadata is recomputed with the now-available probe. The `model_select` handler SHALL also capture the registry as a fallback, without triggering re-registration.

After the re-registration pass, if the session's currently-selected model (`ctx.model`) belongs to one of the re-registered providers, the `session_start` handler SHALL re-invoke `pi.setModel(refreshed)` with the freshly-enriched descriptor obtained via `ctx.modelRegistry.find(ctx.model.provider, ctx.model.id)`. This re-snapshots pi's `agent.state.model` with the enriched `reasoning` / `contextWindow` / `cost` fields, which is required for `setThinkingLevel` to operate correctly against the new capabilities — pi's `supportsThinking()` reads `state.model.reasoning` directly, and without the re-snapshot the session would keep the fallback `reasoning: false` stamped at pre-enrichment registration time. The re-setModel call SHALL be wrapped in try/catch so a failed refresh does not abort `session_start`.

#### Scenario: Enrichment applied via session_start re-registration pass

- **WHEN** a pi session starts with a `proxy` provider in `providers.json` that advertises `cc/claude-opus-4-7` in its `/v1/models` response
- **AND** `entry.api` is `"anthropic-messages"`
- **AND** pi's model registry has a `find` method that returns Opus 4.7 metadata for `("anthropic", "claude-opus-4-7")`
- **THEN** `activate()` SHALL first register the provider with fallback defaults (no registry yet available)
- **AND** the `session_start` handler SHALL then capture `ctx.modelRegistry` and re-register the provider
- **AND** the second `pi.registerProvider(...)` call SHALL carry a model descriptor with `contextWindow: 1_000_000`, `maxTokens: 128_000`, `reasoning: true`, and the registry's cost object

#### Scenario: Currently-selected model is re-snapshotted after re-registration

- **WHEN** the session's `ctx.model` is `{ provider: "proxy", id: "cc/claude-opus-4-7", reasoning: false, … }` at `session_start` (the fallback-defaults snapshot taken during `activate()`)
- **AND** the re-registration pass updates the `proxy` provider's registry entry with enriched metadata (`reasoning: true`, `contextWindow: 1_000_000`, …)
- **THEN** the `session_start` handler SHALL call `ctx.modelRegistry.find("proxy", "cc/claude-opus-4-7")` and pass the result to `pi.setModel(refreshed)`
- **AND** pi's `agent.state.model.reasoning` SHALL become `true` after this call
- **AND** subsequent calls to `pi.setThinkingLevel("high")` SHALL no longer clamp to `"off"`

#### Scenario: Re-setModel failure does not abort session_start

- **WHEN** `pi.setModel(refreshed)` throws (e.g., auth missing for the refreshed model)
- **THEN** the `session_start` handler SHALL catch the error, log it via `console.error`, and continue with the rest of its work (setting `currentSessionProvider` / `currentSessionModelId`, emitting warnings for missing API keys)
- **AND** the session SHALL still be usable — just with the pre-enrichment model snapshot still in place

#### Scenario: Enrichment falls back when registry capture has not happened

- **WHEN** no `session_start` event has fired (e.g., the extension was just activated and pi has not yet started a session)
- **AND** a provider advertises `cc/claude-opus-4-7` under `api: "anthropic-messages"`
- **THEN** `registerEntry()` SHALL still call `pi.registerProvider(...)` successfully
- **AND** the synthesized model descriptor SHALL use the `anthropic-messages` fallback defaults (200k ctx, 64k maxTok, no reasoning, zero cost, `["text","image"]` input)

#### Scenario: Enrichment applied on credentials_updated hot-reload

- **WHEN** a user adds a new provider to `providers.json` whose `/v1/models` response includes `claude-opus-4-7`
- **AND** the server broadcasts `credentials_updated`
- **AND** the bridge's `reloadProviders` flow calls `registerEntry()` for the new provider
- **AND** the registry is available at this point
- **THEN** the synthesized model SHALL have `contextWindow: 1_000_000` (not `200_000`)

#### Scenario: Unknown model on a custom provider still registers successfully

- **WHEN** a proxy advertises a model id that the registry does not know
- **AND** `entry.api` is `"openai-completions"`
- **THEN** `registerEntry()` SHALL still call `pi.registerProvider(...)` with the fallback defaults `{ contextWindow: 128_000, maxTokens: 16_384, reasoning: false, cost: zero, input: ["text","image"] }`
- **AND** the model SHALL be selectable in the dashboard's model picker

#### Scenario: No registry match does not throw

- **WHEN** every discovered id from a provider misses the registry
- **THEN** `registerEntry()` SHALL complete successfully without throwing
- **AND** every model SHALL be registered with fallback defaults

### Requirement: Bridge pushes providers_list message
The bridge SHALL emit a `providers_list` message to the server alongside `models_list` whenever the model registry's provider catalogue is observable. The message SHALL be sent (a) on session register / re-attach (parallel to the existing `models_list` push), (b) on receipt of `credentials_updated`, and (c) in response to `request_providers`.

#### Scenario: providers_list sent at session register
- **WHEN** the bridge has captured `ctx.modelRegistry` and is about to send `models_list` for `sessionId`
- **THEN** the bridge SHALL also send `{ type: "providers_list", sessionId, providers: <ProviderInfo[]> }` to the server

#### Scenario: providers_list refreshed after credential change
- **WHEN** the bridge receives `{ type: "credentials_updated" }` and `modelRegistry` is available
- **THEN** the bridge SHALL build a fresh provider catalogue and send a new `providers_list` for every active sessionId

#### Scenario: providers_list before modelRegistry capture
- **WHEN** the bridge has not yet observed `ctx.modelRegistry`
- **THEN** the bridge SHALL skip the `providers_list` push and the server SHALL receive only `models_list` (which is also skipped today). No error.

### Requirement: Provider catalogue payload shape
Each entry in the `providers` array of `providers_list` SHALL be an object with the following fields, derived from pi's live `ModelRegistry` and the bridge's own custom-provider tracking:

- `id` (string, required): pi-ai provider id (e.g. `"anthropic"`, `"deepseek"`, `"google-vertex"`).
- `displayName` (string, required): from `modelRegistry.getProviderDisplayName(id)`.
- `hasOAuth` (boolean, required): `true` iff `authStorage.getOAuthProviders().some(p => p.id === id)`.
- `configured` (boolean, required): derived from the **registry-level** `modelRegistry.getProviderAuthStatus(id).configured`. This SHALL account for keys supplied via `pi.registerProvider(...)` (stored in pi's `providerRequestConfigs`), not only `auth.json` credentials. When `getProviderAuthStatus` is unavailable on the registry, the bridge MAY fall back to `authStorage.has(id)`.
- `source` (`"stored" | "environment" | "fallback" | "runtime" | "models_json_key" | "models_json_command" | undefined`, optional): from `modelRegistry.getProviderAuthStatus(id).source`, falling back to `authStorage.getAuthStatus(id).source` when the registry-level status is unavailable.
- `envVar` (string, optional): the first env var name returned by pi-ai's `findEnvKeys(id)`.
- `ambient` (boolean, optional): `true` when `pi-ai.getEnvApiKey(id) === "<authenticated>"` (Vertex ADC / Bedrock IAM).
- `expires` (number, optional): for OAuth credentials, the `expires` timestamp from `auth.json`.
- `custom` (boolean, optional): `true` iff the bridge itself registered this provider via `pi.registerProvider(...)` from `~/.pi/agent/providers.json`. Consumers (notably `provider-auth-storage.ts::_buildAuthStatus`) SHALL use this flag to suppress API-key auth rows for custom providers, which are managed by the dedicated **LLM Providers** settings section.

The catalogue SHALL be the union of `authStorage.getOAuthProviders().map(p => p.id)` AND every distinct `provider` value from `modelRegistry.getAll()`. Duplicates are deduplicated by `id`.

The `custom` flag SHALL be set synchronously when the bridge attempts to register a provider from `providers.json`, **independently** of asynchronous model-discovery completion. Specifically, the bridge SHALL track custom-provider ids the moment `registerEntry` is invoked — before any `await` — so that the very first `providers_list` push (typically fired from `session_start` shortly after `activate()` kicked off async `registerEntry` calls) carries the correct flags. This rules out a race where the first push leaks custom providers into Settings → API Keys until the async discovery probe resolves.

#### Scenario: Built-in API-key provider
- **WHEN** pi-ai's `MODELS` table contains a model with `provider: "deepseek"` and the user has not configured any auth
- **THEN** the catalogue SHALL contain `{id: "deepseek", displayName: "DeepSeek", hasOAuth: false, configured: false, envVar: undefined, ambient: undefined}` with no `custom` field

#### Scenario: Provider with env var set but no auth.json entry
- **WHEN** `OPENAI_API_KEY` is exported to the bridge process
- **THEN** the `openai` catalogue entry SHALL have `configured: false`, `source: "environment"`, `envVar: "OPENAI_API_KEY"`

#### Scenario: OAuth provider with stored credentials
- **WHEN** `auth.json` contains `{ "anthropic": { type: "oauth", access, refresh, expires } }`
- **THEN** the `anthropic` catalogue entry SHALL have `hasOAuth: true`, `configured: true`, `source: "stored"`, `expires: <timestamp>`

#### Scenario: Ambient credential (Vertex ADC)
- **WHEN** `GOOGLE_APPLICATION_CREDENTIALS`, `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION` are all set
- **THEN** the `google-vertex` catalogue entry SHALL have `ambient: true` and `source: "environment"`

#### Scenario: Extension-registered provider visible
- **WHEN** another pi extension calls `pi.registerProvider("custom-llm", { models: [...], oauth: {...} })`
- **THEN** the next `providers_list` push SHALL contain a `custom-llm` entry with `hasOAuth: true`

#### Scenario: Saved custom provider reports configured (regression)
- **WHEN** `~/.pi/agent/providers.json` contains a `proxy` entry with a valid `apiKey` and the bridge has registered it via `registerEntry`
- **AND** `auth.json` has NO `proxy` entry (the key lives only in pi's `providerRequestConfigs`)
- **THEN** `modelRegistry.getProviderAuthStatus("proxy").configured` SHALL be `true`
- **AND** the `proxy` catalogue entry SHALL have `configured: true`
- **AND** the dashboard SHALL NOT display "no API key setup" for `proxy`

#### Scenario: Custom provider from providers.json carries custom:true on first push (regression)
- **WHEN** `~/.pi/agent/providers.json` contains a `proxy` entry with `baseUrl` pointing to an OpenAI-compatible endpoint
- **AND** the bridge's `activate()` has begun async `registerEntry("proxy", ...)` but `discoverModels` for `proxy` has NOT yet resolved
- **AND** the bridge calls `buildProviderCatalogue()` to build the first `providers_list` payload
- **THEN** the catalogue SHALL include a `proxy` entry with `custom: true`
- **AND** the server-side consumer `_buildAuthStatus` SHALL skip emitting an API-key row for `proxy`
- **AND** Settings → Provider Authentication → API Keys SHALL NOT list `proxy`

#### Scenario: discoverModels failure for a custom provider
- **WHEN** the bridge's `discoverModels` for `proxy` resolves with HTTP failure or network timeout
- **THEN** `proxy` SHALL still be present in `lastRegistered`
- **AND** the next `providers_list` push SHALL still carry `custom: true` for `proxy`
- **AND** `proxy` SHALL still be filtered from Settings → API Keys

### Requirement: Bridge handles request_providers
When the bridge receives a `request_providers` message from the server, it SHALL respond with a `providers_list` for the message's `sessionId`, using the same catalogue-build logic as the periodic push.

#### Scenario: Server requests refresh
- **WHEN** the bridge receives `{ type: "request_providers", sessionId: "s1" }`
- **THEN** the bridge SHALL emit `{ type: "providers_list", sessionId: "s1", providers: [...] }` based on the current `modelRegistry` state

#### Scenario: Request without modelRegistry
- **WHEN** the bridge receives `request_providers` before `session_start` has captured `ctx.modelRegistry`
- **THEN** the bridge SHALL respond with `{ type: "providers_list", sessionId, providers: [] }` and no error

### Requirement: Custom-provider apiKey resolves to the real secret under pi-ai 0.80.x

When the bridge registers a custom provider via `pi.registerProvider(...)` in `registerEntry()` (`packages/extension/src/provider-register.ts`), the `apiKey` value passed in `ProviderConfigInput` SHALL be a string that pi resolves to the user's actual secret. pi resolves this field natively at request time (`authStorage.getApiKey() ?? resolveConfigValue(apiKey)`), treating a plain string as a **literal** and resolving environment references only via explicit `$ENV_VAR` / `${ENV_VAR}` syntax. Therefore `toRegisterApiKey` SHALL pass the providers.json value straight through, with NO synthetic env var and NO `process.env` mutation:

- a literal key is returned verbatim, with any embedded `$` escaped to `$$` (and a leading `!` escaped to `$!`) so pi's resolver does not misinterpret it as an env reference or shell command, AND
- user-supplied `$ENV_VAR` input retains its `$` prefix so pi interpolates the real secret from the environment.

The bridge SHALL NOT construct a synthetic environment variable (e.g. the former `JUDO_<NAME>_KEY`) nor write the secret into `process.env`.

#### Scenario: Literal key entered in Settings reaches upstream verbatim
- **WHEN** `~/.pi/agent/providers.json` contains a `proxy` entry with `apiKey: "sk-real-123"`
- **AND** the bridge registers `proxy` via `registerEntry`
- **THEN** the value pi-ai resolves for the `proxy` provider's API key SHALL equal `"sk-real-123"`
- **AND** the outbound request SHALL send `Authorization: Bearer sk-real-123`, never a synthetic env-var name
- **AND** the bridge SHALL NOT create any `JUDO_*` (or other synthetic) entry in `process.env`

#### Scenario: $ENV reference entered in Settings is resolved from the environment
- **WHEN** the `proxy` entry has `apiKey: "$PROXY_KEY"` and `process.env.PROXY_KEY === "sk-env-456"`
- **THEN** the value passed to `registerProvider` SHALL retain the `$PROXY_KEY` reference verbatim
- **AND** pi SHALL resolve the `proxy` API key to `"sk-env-456"`

