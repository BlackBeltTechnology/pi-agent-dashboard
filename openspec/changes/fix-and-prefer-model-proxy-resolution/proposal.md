## Why

The dashboard model proxy cannot resolve any model whose id contains a slash. The route handlers parse the requested model with `modelId.split("/", 2)`, which **truncates** at the first slash instead of splitting on it: `openrouter/anthropic/claude-3.5-sonnet` parses to provider `openrouter` + id `anthropic`, `registry.find` misses, and the request 404s — even though `GET /v1/models` advertised that exact id. Every other model-id parse in the repo uses first-slash split (`indexOf` + `slice`); the proxy is the lone deviant.

Separately, the proxy exposes **no way to express a preferred model or ordering**. The only knob is `modelProxy.defaultModel` (a single fallback string used only when a request omits `model`). When the same fully-qualified id collides across sources (built-in vs discovered-custom vs models.json) the winner is decided by accident of array order via `Array.find`. Users cannot say "prefer this model" or give a short alias for a provider path.

## What Changes

- **Fix model-id parsing** — replace both `split("/", 2)` resolution sites (`model-proxy-routes.ts`) with first-slash split so multi-slash ids (`openrouter/anthropic/claude-3.5-sonnet`, custom OpenRouter-style ids) resolve. Extract a shared `parseModelId(label)` helper in `packages/shared` and converge the proxy call sites onto it (the repo's existing convention).
- **Round-trip invariant** — every id advertised by `GET /v1/models` MUST resolve in `POST /v1/chat/completions` and `POST /v1/messages`. Add a regression test asserting this.
- **Deterministic source precedence** — dedup `getAllModels()` by fully-qualified `provider/id`, keeping the first by documented precedence (built-in → discovered-custom → models.json). Removes duplicate `/v1/models` entries and makes `find` deterministic-by-design instead of by-accident.
- **`modelProxy.preferredModels: string[]`** (new) — ordered list of fully-qualified ids. First *available* entry is used when a request omits `model` or names a bare/unresolved model. Supersedes `defaultModel` when both are set; `defaultModel` stays honored for back-compat.
- **`modelProxy.modelAliases: Record<string,string>`** (new) — alias → fully-qualified id, expanded before parsing. Lets a caller send `claude` and route to `anthropic/claude-3.5-sonnet` (prefer a specific provider path for a logical model).
- **Config parse + persistence** — `parseModelProxyConfig` validates the two new fields; Settings → API Proxy persists them via `PUT /api/config`.

No breaking changes: existing single-slash ids and `defaultModel` behave exactly as before.

## Capabilities

### New Capabilities
<!-- none — extends the existing model-proxy capability -->

### Modified Capabilities
- `model-proxy`: adds a **Model ID resolution** requirement (first-slash parse, alias expansion, preferred-model fallback, round-trip invariant, deterministic source precedence) and extends the Settings-persistence requirement to cover `preferredModels` + `modelAliases`.

## Impact

- **Code**: `packages/server/src/routes/model-proxy-routes.ts` (parse sites), `packages/server/src/model-proxy/internal-registry.ts` (dedup + preference-aware resolve), `packages/shared/src/config.ts` (`ModelProxyConfig` + `parseModelProxyConfig`), new `parseModelId` helper in `packages/shared`, Settings UI (API Proxy section).
- **APIs**: `/v1/models`, `/v1/chat/completions`, `/v1/messages` resolution behavior; `PUT /api/config` accepts two new `modelProxy` fields.
- **Config file**: `~/.pi/dashboard/config.json#modelProxy` gains `preferredModels`, `modelAliases`.
- **Tests**: `model-proxy-routes.test.ts` (slash-bearing ids, round-trip), new resolution/precedence unit tests, `parseModelProxyConfig` validation tests.

## Discipline Skills

- `doubt-driven-review` — the resolution precedence + alias/preference semantics are a public-proxy-API behavior change; stress-test the ordering rules before they stand.
- `systematic-debugging` — the split bug is a live defect; reproduce with a failing test first.
