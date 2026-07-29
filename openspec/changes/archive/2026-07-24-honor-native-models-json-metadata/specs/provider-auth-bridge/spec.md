# provider-auth-bridge — delta

## MODIFIED Requirements

### Requirement: registerEntry wires modelRegistry into enrichModelMetadata

`registerEntry()` in `packages/extension/src/provider-register.ts` SHALL register the
**union** of (a) the provider's `/v1/models`-discovered ids and (b) the ids authored under
`providers.<name>.models[]` in the user-authored `~/.pi/agent/models.json`. A user-authored
model that discovery does not return (or when `/v1/models` is unreachable) SHALL therefore
still be registered into the session and surfaced in `models_list`, matching the server
path and preserving models when `/v1/models` is unavailable.

For each id in the union, `registerEntry()` SHALL resolve metadata in the following
precedence order, first hit wins:

1. **Native `models.json`** — the entry in `~/.pi/agent/models.json`
   `providers.<name>.models[]` matching this provider `name` and discovered `id`. When
   present it supplies `contextWindow`, `maxTokens`, `reasoning`, `thinkingLevelMap`,
   `compat`, `input`, and `cost`.
2. **Session registry probe** — `modelRegistryRef.find(name, id)` (pi's own native load
   for the custom provider name), when available and not yet shadowed.
3. **`enrichModelMetadata(id, api, probe)`** — the existing api-typed fallback (probe =
   `(provider, id) => registry.find(provider, id) ?? null` over built-in candidate
   providers) when neither native source matches.

The resolved metadata SHALL be spread into the model descriptor passed to
`pi.registerProvider(name, { models })`, and the descriptor SHALL carry `thinkingLevelMap`
and `compat` when the native source provided them, so pi's thinking-level clamp
(`getSupportedThinkingLevels`) and request formatting (`compat`, e.g. `thinkingFormat` /
`supportsReasoningEffort`) operate on the true native capabilities. The existing behavior
of using the bare discovered id as `id` and `name` SHALL be preserved. The native
`models.json` read SHALL be read-only and defensive (a malformed file/block yields no
native metadata for that block and SHALL NOT throw — the fallback chain still applies).

The `session_start` re-registration pass, registry capture, and post-registration
re-`setModel` snapshot behavior SHALL be retained; after this change the re-snapshotted
model SHALL additionally carry the native `thinkingLevelMap`/`compat` so
`setThinkingLevel` honors native levels (including a native `max` when the session runtime
supports it).

#### Scenario: Native models.json metadata wins over enrichment fallback

- **WHEN** a pi session starts with a `newapi` provider in `providers.json` that advertises `glm-5.2` in its `/v1/models` response
- **AND** `~/.pi/agent/models.json` declares `providers.newapi.models[]` with `glm-5.2` carrying `contextWindow: 200000`, `maxTokens: 65536`, `reasoning: true`, a `thinkingLevelMap`, and a `compat` object
- **THEN** the `pi.registerProvider("newapi", { models })` descriptor for `glm-5.2` SHALL carry `contextWindow: 200000`, `maxTokens: 65536`, `reasoning: true`, the native `thinkingLevelMap`, and the native `compat`
- **AND** it SHALL NOT use the api-typed fallback floors

#### Scenario: User-authored model absent from /v1/models is still registered

- **GIVEN** `providers.newapi.models[]` declares `glm-5.2` but the provider's `/v1/models` response omits it (or `/v1/models` is unreachable)
- **WHEN** `registerEntry("newapi", …)` runs
- **THEN** `glm-5.2` SHALL be registered into the session with its user-authored metadata
- **AND** it SHALL appear in the next `models_list` push

#### Scenario: Falls back to enrichment when no native entry exists

- **WHEN** a provider advertises a model id that has no `providers.<name>.models[]` entry in `models.json`
- **THEN** `registerEntry()` SHALL fall back to the session registry probe, then to `enrichModelMetadata` api-typed defaults, exactly as before
- **AND** the model SHALL still register successfully and be selectable

#### Scenario: Malformed models.json does not break registration

- **GIVEN** `~/.pi/agent/models.json` is syntactically invalid or `providers.newapi.models` is not an array
- **WHEN** `registerEntry("newapi", …)` runs
- **THEN** it SHALL fall back to enrichment for that provider without throwing
- **AND** other providers SHALL register normally

#### Scenario: thinkingLevelMap flows to the web selector via models_list

- **GIVEN** `newapi/glm-5.2` registered with a native `thinkingLevelMap`
- **WHEN** the bridge pushes `models_list`
- **THEN** the `ModelInfo` for `newapi/glm-5.2` SHALL carry `supportedThinkingLevels` derived from the native `thinkingLevelMap`
- **AND** the web `ThinkingLevelSelector` SHALL render exactly those levels

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

