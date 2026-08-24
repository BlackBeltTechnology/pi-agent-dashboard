## Why

Custom providers that DO advertise rich model metadata are ignored. A live probe of the
configured 9router provider returns, for `cc/claude-opus-5`:

```json
"context_length": 1000000, "max_completion_tokens": 128000,
"capabilities": { "reasoning": true, "vision": true, "tools": true,
                  "thinkingFormat": "claude-adaptive", "thinkingCanDisable": true,
                  "thinkingRange": null, "contextWindow": 1000000, "maxOutput": 128000 }
```

The dashboard shows `ctx=200000, maxTok=64000, reasoning=false` for that model — and for
every other model in the provider, identically. `200000/64000/false` is verbatim the
`anthropic-messages` fallback record: nothing from the endpoint reaches the UI.

The provider endpoint is correct; the loss is ours. Both discovery paths drop the
response body one function too early, then stamp every id with a hardcoded floor. The
wrong context window mis-sizes compaction, and `reasoning: false` erases the thinking
levels the model actually supports.

The load-bearing assumption behind the floors — recorded in comments at
`custom-provider-discovery.ts:27-29` and `provider-register.ts:92-94`, *"Custom
`/v1/models` endpoints do not advertise context_window / cost / reasoning"* — is no
longer true for metadata-rich proxies. The floors were correct when written; they are a
stale premise now, not a bad decision.

The floors are also not a safe conservative default in either direction. The same probe
shows `ag/claude-opus-4-6-thinking` advertising **200k** while pi's catalog lists
`claude-opus-4-6` at **1M** — so name-matched catalog enrichment can *overstate* a proxy's
real limit just as the floors understate it. Only the endpoint knows what a given proxy
route actually serves, which is why it must be the authority for custom providers.

## What Changes

- **Preserve the `/v1/models` response body.** Add a metadata-preserving discovery
  function beside `listProviderModelIds`, returning per-model records instead of
  `string[]`. `listProviderModelIds` and `probeProvider` keep their current signatures
  and behaviour — the Test button is untouched.
- **Map advertised fields by RESPONSE SHAPE, not by configured api family.** This is
  load-bearing: the working 9router provider is configured `api: "anthropic-messages"`
  yet returns an OpenAI-style `{ data: [...] }` body. A mapper keyed on the configured api
  would miss it entirely — the exact bug being fixed. Shape detection mirrors
  `extractModelIds`, which already keys on `body.data` / `body.models` independently of
  `api`.
  - OpenAI-ish (`body.data[]`): `context_length`, `max_completion_tokens`, and the
    `capabilities` block (`reasoning`, `vision`, `tools`, `contextWindow`, `maxOutput`,
    `thinkingFormat`, `thinkingCanDisable`, `thinkingRange`).
  - Google-ish (`body.models[]`): `inputTokenLimit`, `outputTokenLimit`,
    `supportedGenerationMethods`. **None of these are read anywhere in the repo today**
    (grep: zero hits) — this is new mapping, not a port.
  - Conflict rule: when both a top-level scalar and its `capabilities` twin are present
    (`context_length` vs `capabilities.contextWindow`, `max_completion_tokens` vs
    `capabilities.maxOutput` — 9router sends both, currently equal), the top-level scalar
    wins; the twin is the fallback. Defined so a future divergence is not a coin-flip.
  - `input` modality: `capabilities.vision` → add `"image"`. The `input` type admits only
    `"text" | "image"`, so advertised `pdf`/`audioInput`/`videoInput`/`imageOutput`/
    `audioOutput`/`search` are deliberately DROPPED, not widened into the type.
  - Field-level and defensive: each field is adopted only when present and well-typed.
- **`reasoning` comes from the endpoint** so thinking levels stop being erased by a
  hardcoded `reasoning: false`. **`thinkingLevelMap` synthesis is a defined open question,
  not an assumption**: 9router sends `thinkingFormat: "claude-adaptive"`,
  `thinkingCanDisable: true`, `thinkingRange: null`. A null range does not determine a
  level map, and inventing one risks re-breaking thinking levels with *different* wrong
  values — the failure this change exists to end. The spec must define the mapping for
  each `(thinkingFormat, thinkingRange)` combination actually observed, and MUST leave
  `thinkingLevelMap` absent when the inputs are underdetermined (`reasoning: true` alone
  already restores level availability).
- **Fill at the earliest point.** Both paths stamp metadata during discovery, before any
  cache is populated — so every downstream reader (registry cache, `GET /api/models`,
  bridge `models_list`, model selector) sees faithful values with no added round-trip.
- **Fall back only on silence, per field.** Partial metadata is real, not hypothetical: a
  probe of this provider returned 43 models of which 3 (`claude-opus-4-7-glm-5-1`,
  `claude-sonnet-4-6-glm-5`, `claude-haiku-4-5-20251001`) advertised no `context_length`
  at all. A model advertising nothing keeps today's api-typed floors.
- **BREAKING (provenance): `metadataSource` gains a third value.** Today it is
  `"catalog" | "fallback"` (`packages/shared/src/types.ts:601`,
  `packages/extension/src/provider-register.ts:56`), and `ModelSelector.tsx:109` renders
  "uncertain" capability icons for `"fallback"`. Endpoint-sourced metadata is neither:
  stamping it `"catalog"` would erase the distinction, and leaving it `"fallback"` would
  paint confirmed data as uncertain. An `"endpoint"` value is required, so the shared type
  and the selector's provenance branch DO change (contradicting an earlier draft of this
  proposal that claimed both were untouched). A model with partial metadata is reported by
  its weakest adopted field, so "uncertain" is never shown over a confirmed value.
- **Close the same gap on the in-session path.** The extension's `discoverModels` keeps
  only `{ id, owned_by }`; it gains the same preservation, and advertised metadata takes
  precedence over `enrichModelMetadata`'s name-matched catalog guess — which cannot
  resolve prefixed or hybrid ids (`ag/claude-opus-4-6-thinking`, `glm/glm-5.3`) at all.
- **Built-in providers are untouched.** Discovery iterates only
  `providers.json#providers`. Built-in pi-ai models never enter this path and keep their
  bundled catalog metadata and existing precedence.

Precedence after this change, first hit wins:

`native models.json` → **endpoint-advertised** → catalog probe → api-typed floors

User-authored `models.json` stays the top override; endpoint data outranks name-matched
guessing but never silently overrides an explicit local declaration.

**Not** in scope: refreshing a running server's already-populated cache. Opening the
model selector does trigger `request_models`, but that re-projects
`discoveredCustomModels`, which is filled once by a fire-and-forget `discover()` at
singleton construction (`registry-singleton.ts:108`). After this change a restart still
picks up corrected values; a TTL or explicit invalidation is a separable decision with
its own cost (a live HTTP round-trip per provider per popover open) and is deliberately
excluded.

That exclusion carries a **measured** cost, recorded here rather than discovered later:
two probes of this provider minutes apart returned **43 then 40 models**, with the three
bare-id hybrids present in the first and absent in the second. The custom-provider model
set is genuinely dynamic, so a once-per-process discovery will drift from the provider
regardless of this fix. This change makes the values *faithful when read*; keeping them
fresh is the separable follow-up.

## Capabilities

### New Capabilities
- `custom-provider-metadata-discovery`: fetch, preserve, and map advertised model
  capability metadata from a custom provider's `/v1/models`, with defensive per-field
  adoption and fallback only when a field is absent.

### Modified Capabilities
- `custom-provider-model-registry`: the requirement *"Discovered-only model keeps
  fallback floors"* currently mandates the broken behaviour — a discovered-only model
  retains api-typed floors unconditionally. It must narrow to: floors apply only when the
  endpoint advertised nothing for that field. The native-wins-over-discovery precedence
  is preserved, with endpoint data inserted between native and the floors.

## Impact

- `packages/server/src/package/provider-probe.ts` — new metadata-preserving discovery fn;
  `extractModelIds`, `listProviderModelIds`, `probeProvider` unchanged.
- `packages/server/src/model-proxy/custom-provider-discovery.ts` — consume preserved
  metadata; `FALLBACK` floors become per-field defaults instead of unconditional stamps.
- `packages/server/src/model-proxy/internal-registry.ts` — merge order gains the endpoint
  tier; `CustomModelEntry` already carries every needed field (`contextWindow`,
  `maxTokens`, `reasoning`, `thinkingLevelMap`, `input`, `cost`), so no type change there.
- `packages/extension/src/provider-register.ts` — `DiscoveredModel` widens beyond
  `{ id, owned_by }`; advertised metadata outranks the catalog probe.
- `packages/shared/src/types.ts` — `metadataSource` union gains `"endpoint"`.
- `packages/client/src/components/settings/ModelSelector.tsx` — provenance branch handles
  `"endpoint"` (confirmed, not uncertain). No layout or field-rendering change.
- Unchanged: the `GET /api/models` field set (only `metadataSource`'s value domain
  widens), the provider Test button (`probeProvider`/`extractModelIds` untouched),
  built-in provider handling, and the read-only treatment of `~/.pi/agent/models.json`.
- Security: the preserved body is model metadata only — no credential material enters the
  registry or logs, and `compat` remains unserialized over `/api/models`.
- Risk: a provider advertising implausible values now influences the UI. Mitigated by
  per-field type/range validation, ignoring malformed fields rather than trusting them.
- Note on URL construction (pre-existing, NOT fixed here): for `anthropic-messages`,
  `buildProbeRequest` builds `${base}/v1/models`, and this provider's `baseUrl` already
  ends in `/v1` — yielding `/v1/v1/models`. Both that and `/v1/models` return HTTP 200
  here because the proxy is lenient. The new discovery reuses `buildProbeRequest`
  unchanged, inheriting this behaviour; a stricter provider would 404 on it. Flagged as a
  separate latent bug, deliberately out of scope.

## Discipline Skills

- `security-hardening` — parsing an external provider response into registry state
  (untrusted input); confirm no credential leaks into logs or `/api/models`.
- `review-code` — touches two discovery paths plus registry merge order; non-trivial
  change reviewed before commit.
- `systematic-debugging` — root cause is already evidenced (endpoint verified correct,
  discard points located); applies if the fix does not move the observed values.
