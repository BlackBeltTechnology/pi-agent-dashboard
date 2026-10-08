## MODIFIED Requirements

### Requirement: Model metadata enriched via pi's model registry

When the bridge extension's `registerEntry()` function synthesizes a model descriptor for `pi.registerProvider(...)`, it SHALL resolve `contextWindow`, `maxTokens`, `reasoning`, `cost`, and `input` via a pure helper `enrichModelMetadata(discoveredId, api, probe)` that consults pi's `ModelRegistry.find(provider, id)` API through an injected probe. The probe SHALL be built from a module-level `modelRegistryRef` that is captured from `ctx.modelRegistry` in the first `session_start` event handler (and as a fallback, `model_select`) the extension receives. Because `activate()` fires before any event handler, the first registration pass MAY use fallback defaults; the `session_start` handler SHALL trigger an idempotent re-registration pass once `ctx.modelRegistry` is available, overwriting fallback entries with enriched metadata. When no `session_start` handler has yet fired (e.g., in isolated unit tests), the probe SHALL be `null` and the helper SHALL fall through to api-appropriate fallback defaults.

The helper SHALL strip common proxy-prefix path segments before registry lookup so that prefixed ids (e.g., `cc/claude-opus-4-7`, `anthropic/claude-opus-4-7`, `openrouter/anthropic/claude-opus-4-7`) resolve to the same registry entry as the bare id (`claude-opus-4-7`). Specifically, the helper SHALL try the full discovered id first, then the segment after the last `/` if any — in a deduplicated list.

Registry probing SHALL iterate a fixed api-appropriate candidate-provider list in preference order, returning the first match. The helper SHALL tolerate probes that throw by catching the exception and continuing to the next candidate.

The helper SHALL NOT import `@earendil-works/pi-ai` directly; it SHALL consume only the probe function passed as its third argument, which makes it fully unit-testable with a fake probe built from a `Map`.

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
