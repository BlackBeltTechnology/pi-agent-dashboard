# Tasks

## 1. Shared parse helper + config schema

- [ ] 1.1 Add `parseModelId(label)` to `packages/shared/src` (first-slash split; `provider === ""` when no slash) + export it.
- [ ] 1.2 Write unit tests for `parseModelId`: no slash, single slash, multi-slash (`a/b/c` → provider `a`, id `b/c`), leading slash, empty string.
- [ ] 1.3 Extend `ModelProxyConfig` in `packages/shared/src/config.ts` with optional `preferredModels?: string[]` and `modelAliases?: Record<string,string>`.
- [ ] 1.4 Extend `parseModelProxyConfig` to validate both fields (drop non-string / empty entries; preserve `preferredModels` order; omit empty fields). Write validation unit tests (valid, garbage, mixed, absent).

## 2. Registry: deterministic precedence + preference-aware resolve

- [ ] 2.1 Write a failing test: two sources produce the same fqid → `getAll()`/`getAvailable()` returns exactly one entry, built-in wins.
- [ ] 2.2 Implement dedup-by-fqid in `InternalRegistry.getAllModels()` (keep first; push-order = precedence built-in → discovered-custom → models.json). Make test pass.
- [ ] 2.3 Add a `firstAvailable(preferred: string[])` helper (walk order, return first entry present in `getAvailable()`), with tests.

## 3. Route resolution wiring

- [ ] 3.1 Write a failing route test: POST `/v1/chat/completions` with `model: "openrouter/anthropic/claude-3.5-sonnet"` (registry mock has provider `openrouter`, id `anthropic/claude-3.5-sonnet`) resolves (not 404).
- [ ] 3.2 Replace both `split("/", 2)` resolution sites and both `[provider] = split("/", 2)` concurrency sites in `model-proxy-routes.ts` with `parseModelId`.
- [ ] 3.3 Implement the resolution order (alias expand → parse → find → preferred fallback → 404) for both `/v1/chat/completions` and `/v1/messages`, sharing one resolver. Wire `getConfig().modelAliases` / `preferredModels` / `defaultModel`.
- [ ] 3.4 Make 3.1 pass; add tests for alias expansion, preferred fallback on omitted model, `preferredModels` supersedes `defaultModel`, and unresolved → 404.

## 4. Settings UI (API Proxy section)

- [ ] 4.1 Add a Preferred Models drag-to-reorder list (per-row availability pill + remove) and a Model Aliases `key → value` editor to the API Proxy section. Reuse `ModelSelector` for the Preferred Models "Add model" control and for each alias value (no free-text model entry). Follow `mockups/settings-api-proxy.html`.
- [ ] 4.2 Include both fields in the diff-and-merge `PUT /api/config` payload (mirror existing `modelProxy` field handling).
- [ ] 4.3 Client test: editing preferred models / aliases and clicking Save sends `modelProxy.preferredModels` / `modelProxy.modelAliases`; "No changes to save" still correct when untouched.

## Tests

- [ ] T.1 `parseModelId` unit tests (1.2) green.
- [ ] T.2 `parseModelProxyConfig` validation tests (1.4) green.
- [ ] T.3 Registry precedence + `firstAvailable` tests (2.1–2.3) green.
- [ ] T.4 Route resolution tests — multi-slash id, round-trip invariant (every `/v1/models` id resolves), alias, preferred fallback, supersede, 404 (3.1, 3.4) green.
- [ ] T.5 Settings persistence test (4.3) green.
- [ ] T.6 `npm test` full suite green; no regression in existing `model-proxy-*` tests.

## Validate

- [ ] V.1 `openspec validate fix-and-prefer-model-proxy-resolution --strict` passes.
- [ ] V.2 Manual: with a custom OpenRouter provider configured, `GET /v1/models` lists `openrouter/...` ids and each resolves on `POST /v1/chat/completions` (no 404).
- [ ] V.3 Manual: set `preferredModels` + an alias in Settings, Save, restart; omitted-model request uses the first available preferred; alias routes to its target.
- [ ] V.4 Run `code-review` + `code-quality` gates on the diff before commit.

## Discipline Skills

- `systematic-debugging` — reproduce the split bug with a failing test (3.1) before fixing.
- `doubt-driven-review` — stress-test the resolution-order precedence (Decision 3) and source precedence (Decision 2) before they stand.
