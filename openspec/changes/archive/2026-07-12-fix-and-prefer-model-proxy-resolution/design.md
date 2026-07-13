# Design

## Context

The model proxy (`packages/server/src/routes/model-proxy-routes.ts` + `packages/server/src/model-proxy/internal-registry.ts`) fronts the dashboard's model registry with OpenAI- and Anthropic-compatible endpoints. Two independent defects/gaps in the resolution path:

1. **Parse bug** — `modelId.split("/", 2)` truncates instead of splitting. `"a/b/c".split("/", 2) === ["a", "b"]`; the remainder is dropped, so any model whose id contains a slash (OpenRouter-style custom ids) is unreachable and 404s despite being advertised by `/v1/models`.
2. **No preference mechanism** — only `defaultModel` (single fallback) exists. Source collisions resolve by `Array.find` order (implicit, undocumented).

## Goals / Non-Goals

**Goals**
- Multi-slash ids resolve; round-trip invariant holds (advertised ⇒ resolvable).
- Deterministic, documented source precedence for colliding fully-qualified ids.
- User-facing preference: an ordered `preferredModels` list + `modelAliases` map.
- One shared `parseModelId` helper; proxy routes stop deviating from the repo convention.

**Non-Goals**
- No "auto-pick the cheapest/fastest route to a logical model" — the caller still addresses by fully-qualified id or an explicit alias.
- No change to auth, concurrency, streaming, or convert layers.
- No cross-provider capability negotiation.

## Decision 1 — First-slash parse via a shared helper

Add `parseModelId(label: string): { provider: string; modelId: string }` in `packages/shared` (mirrors the existing `goal-plugin/parseModelLabel`):

```ts
export function parseModelId(label: string): { provider: string; modelId: string } {
  const slash = label.indexOf("/");
  if (slash <= 0) return { provider: "", modelId: label };
  return { provider: label.slice(0, slash), modelId: label.slice(slash + 1) };
}
```

Replace both `split("/", 2)` resolution sites (lines ~125, ~250) and the two `[provider] = split("/", 2)` concurrency sites (lines ~101, ~228) with this helper so there is a single parse path. `provider === ""` means "no provider" → triggers the preferred-model fallback.

**Why a shared helper, not inline:** four call sites in one file plus three other ad-hoc parses in the repo already exist; a shared function is DRY and prevents the next deviation. Scope of this change converges only the proxy sites; the other three (extension/goal-plugin) are noted but out of scope.

## Decision 2 — Deterministic source precedence (dedup by fqid)

`InternalRegistry.getAllModels()` currently pushes built-in, then discovered-custom, then models.json, with no dedup. `find` returns the first match — correct today only by accident of order.

Make it explicit: dedup by `` `${provider}/${id}` `` keeping the **first** occurrence, with source push-order = precedence: built-in → discovered-custom → models.json. This:
- removes duplicate `/v1/models` entries,
- makes `find` deterministic by design,
- is documented in the spec (so future readers know built-in wins).

**Alternative rejected:** a config-driven `sourcePrecedence` array. Adds surface for a case nobody has hit; `preferredModels` already lets a user force a specific fqid. Keep precedence fixed + documented.

## Decision 3 — Resolution order (aliases → parse → find → preferred fallback)

Single resolution function used by both endpoints:

```
label = request.model ?? firstAvailable(preferredModels) ?? defaultModel
if (!label) → 400
label = modelAliases[label] ?? label          // alias expansion (exact key match)
{ provider, modelId } = parseModelId(label)
model = provider ? registry.find(provider, modelId) : null
if (!model) model = firstAvailable(preferredModels)   // bare or unresolved fallback
if (!model) → 404
```

- **Alias values must be fully qualified.** An alias pointing at a bare name is treated as bare (falls through to preferred fallback). Documented; not validated hard (keeps parse total).
- **`preferredModels` supersedes `defaultModel`** when both set and a preferred entry is available. `defaultModel` stays honored for back-compat (config migration-free).
- `firstAvailable(list)` walks the ordered list, returns the first entry present in `registry.getAvailable()`.

**Why alias-before-parse:** an alias is a whole-label token (`claude`), not a provider — expanding first keeps the parse rule simple (always first-slash).

## Decision 4 — Config schema + validation

Extend `ModelProxyConfig`:

```ts
preferredModels?: string[];              // ordered fully-qualified ids
modelAliases?: Record<string, string>;   // alias → fully-qualified id
```

`parseModelProxyConfig` validation (defensive, total — never throws on bad config):
- `preferredModels`: keep only non-empty string entries, preserve order; omit field if empty/absent.
- `modelAliases`: keep only entries where key and value are non-empty strings; omit if empty/absent.

Persistence rides the existing diff-and-merge `PUT /api/config` path (no new endpoint).

**Settings UI reuses the existing `ModelSelector` primitive** (`packages/client/src/components/ModelSelector.tsx`) for all model picking — no free-text model entry:
- **Preferred Models**: a drag-to-reorder ordered list (order = priority); each row shows the fqid + a registry availability pill (`available` / `no credential`) + remove. The **add** control is a `ModelSelector` trigger ("Add model ▾") whose dropdown carries provider filter, ★ favorites, text filter, capability + context-window badges; selecting appends to the list.
- **Model Aliases**: rows of `key (free text) → ModelSelector trigger (value)`. The alias value is chosen from the same selector, guaranteeing the target is a real fully-qualified id (removes the need for hard value validation). Empty add row + "Add alias".

See mockup: `mockups/settings-api-proxy.html` (grounded in real theme tokens + `ModelSelector`).

## Risks

- **Registry caching**: `getAllModels` dedup runs inside the existing `cachedAllModels` memo — dedup once per cache fill, invalidated by `refresh()`/`discover()`. No perf regression (dedup is O(n) over a small list).
- **Alias loops**: aliases expand exactly once (no recursive alias→alias), so no cycle risk.
- **Back-compat**: single-slash ids + `defaultModel` unchanged; new fields optional. Non-breaking.

## Migration

None. New config fields are optional; absent config behaves as before (single `defaultModel` fallback, built-in-first precedence — now documented rather than implicit).
