# Tasks — honor native models.json metadata for discovered custom models

> TDD: write the failing test in each group first, then minimal implementation.
> Extension changes → `npm run reload`. Server changes → `curl -X POST
> http://localhost:8000/api/restart`. Client changes → `npm run build` + restart.
> See the `implement` skill.

## 1. Verify the shadowing model (design assumption D-E1)

- [x] 1.1 Investigate + record: does `pi.registerProvider(name, {models})` REPLACE or MERGE pi's natively-loaded `~/.pi/agent/models.json` `providers.<name>.models[]` for the same provider? Confirm whether `modelRegistry.find(name, id)` returns the native entry before re-registration. Document the finding in design.md; it fixes whether the extension reads native `models.json` directly (safe either way) or can rely on the registry probe.

## 2. Shared user-authored models.json reader (D-X2)

- [x] 2.1 Test: shared reader flattens `providers.<p>.models[]` → entries stamped `provider` (parent key wins over in-entry `provider`); accepts legacy top-level array + `{models:[]}`; per-provider defensive (malformed block → `[]` for that block, no throw). (RED) (test-plan: automated)
- [x] 2.2 Impl: extract ONE pure reader into the shared package; both the extension (§3) and server (§4) consume it so the flatten/precedence logic cannot diverge.

## 3. Extension: union ids + probe native metadata before enrichment fallback (E-①/E-②, I6)

- [x] 3.1 Test: `registerEntry("newapi", …)` registers the UNION of `/v1/models` ids and `providers.newapi.models[]` ids; a user-authored id absent from `/v1/models` (or when `/v1/models` is unreachable) is still registered + appears in `models_list`. (RED) (test-plan: automated)
- [x] 3.2 Test: for a discovered `glm-5.2` with a user-authored entry → `pi.registerProvider` descriptor carries native `contextWindow/maxTokens/reasoning/thinkingLevelMap/compat/input/cost`, NOT fallback floors. — see `packages/extension/src/__tests__/provider-register-thinking-levels.test.ts`. (test-plan: automated)
- [x] 3.3 Test: no native entry → falls back to registry probe then `enrichModelMetadata` api-typed defaults, model still registers + selectable. (test-plan: automated)
- [x] 3.4 Impl: in `registerEntry`, build the id union, add a metadata resolver (native file → registry probe → `enrichModelMetadata`); extend `ModelMetadata` with `thinkingLevelMap?`/`compat?`; spread both into the `registerProvider` descriptor. `thinkingLevelMap`/`compat` come from the shared file reader (path 1), so `CatalogProbe`'s return type is unchanged.

## 3b. Extension + client: version-gated `max` thinking level (E-③/⑤)

- [x] 3b.1 Impl: session-runtime capability probe — detect whether the session's pi advertises `max` in its canonical thinking-level set; expose a `maxSupported` boolean. Fail closed (false) when undetectable.
- [x] 3b.2 Test: `deriveSupportedThinkingLevels(reasoning, map, maxSupported)` includes `max` ONLY when `maxSupported && map.max != null`; excludes it when `maxSupported` false OR map omits `max`. Uses a SYNTHETIC table (not the pinned pi-ai 0.75.5 fn, which has no `max`): `{max:"max", others:null}` + `maxSupported:true` → `["off","max"]`; same + `maxSupported:false` → `["off"]`. (RED) (test-plan: automated)
- [x] 3b.3 Impl: add the explicit `if (level==="max") return maxSupported && map.max != null` branch (fail-closed) + `max` to the extension canonical list; add `maxSupported` param evaluated at the `toModelInfo` call site; carry `thinkingLevelMap` through `toModelInfo` → `ModelInfo`.
- [x] 3b.4 Impl: add `max` to web `THINKING_LEVELS` in `ThinkingLevelSelector.tsx` so its `supportedLevels` filter can pass it through; fallback set stays six (no `max`).
- [x] 3b.5 Test (client): `ThinkingLevelSelector` renders `max` only when `supportedLevels` includes it; never in the undefined/empty fallback. — see `packages/client/src/__tests__/ThinkingLevelSelector.test.tsx`. (test-plan #E12)
- [x] 3b.6 Test: `toModelInfo` on a `newapi/glm-5.2` registered with a native `thinkingLevelMap` → `ModelInfo.supportedThinkingLevels` derived from that map (so `models_list` carries it end-to-end to the selector). — see `packages/extension/src/__tests__/provider-register-thinking-levels.test.ts`. (test-plan #F1)

## 4. Server: read native nested models.json (S-②)

- [x] 4.1 Test: `readModels` with `providers.newapi.models[]` returns a flattened `CustomModelEntry` stamped `provider:"newapi"` carrying `contextWindow/maxTokens/reasoning/thinkingLevelMap/compat/input/cost`; parent key wins over any in-entry `provider`. (RED) — see `packages/server/src/model-proxy/__tests__/`. (test-plan: automated)
- [x] 4.2 Test: legacy top-level array + `{models:[]}` still parse; on a `provider/id` collision the nested native entry wins. (test-plan: automated)
- [x] 4.3 Test: malformed `providers.<p>.models` (per-provider) yields `[]` for that block, does not throw, other providers still read; a JSON parse failure emits a `console.warn`. (test-plan: automated)
- [x] 4.4 Impl: route `readModels` through the shared reader (§2) to detect `parsed.providers` and flatten per-provider (defensive, read-only, warn on parse failure); add `thinkingLevelMap?`/`compat?` to `CustomModelEntry`.

## 5. Server: field-level outer join + projection (S-①/S-③/S-④)

- [x] 5.1 Test: `getAllModels` merges discovered `newapi/glm-5.2` (fallback) + native entry → native `contextWindow/maxTokens/reasoning/thinkingLevelMap/compat/input/cost`; routing `baseUrl/api/oauthCompatible` from discovery. (RED) (test-plan: automated)
- [x] 5.2 Test: native-only entry (no discovery) surfaces, routing from `providers.json`; discovered-only keeps fallback floors; built-in wins over any custom `provider/id`; `oauthCompatible` never taken from native. (test-plan: automated)
- [x] 5.3 Test: `toRow` emits the RAW `thinkingLevelMap`, derives NO `supportedThinkingLevels` server-side, and NEVER emits `compat` or any credential — default and `?annotated=1`. (RED) (test-plan: automated)
- [x] 5.4 Impl: replace entry-level keep-first dedup for custom models with a per-`provider/id` field merge (routing from discovery, capabilities native-wins, `oauthCompatible` from discovery, outer join, built-in first). Carry `compat` on the registry model.
- [x] 5.5 Impl: extend `toRow` to pass through the raw `thinkingLevelMap`; do NOT derive supported levels server-side; exclude `compat` and credentials.

## 6. Single-sourced derivation (D-X1)

- [x] 6.1 Verify: exactly ONE authored `deriveSupportedThinkingLevels` exists (extension), parameterized by `maxSupported`; the server derives nothing (§5.5). A grep/test guard asserts no second derivation copy. (test-plan: automated)

## 7. Security + verify + land

- [x] 7.1 Test: no `apiKey`/credential and no `compat` in `/api/models` (both variants), `models_list` `ModelInfo`, or logs. (test-plan: automated)
- [x] 7.2 `npm test 2>&1 | tee /tmp/pi-test.log` green for touched suites; `openspec validate honor-native-models-json-metadata --strict`.
- [x] 7.3 Manual (QA): real `providers.<p>.models[]` native entry with `thinkingLevelMap` incl. `max` on a max-capable pi → web selector shows `max`; `GET /api/models` shows native ctx/maxTokens/reasoning/thinkingLevelMap and no `compat`. Tested during ship, not pre-merge. (test-plan: manual-only)
- [x] 7.4 `review-code` + `security-hardening` pass on the diff (credential/compat leak check) before commit.
- [x] 7.5 Docs: DocScribe notes the `models.json`-hot-reload limitation (refresh/restart needed) + the built-in-provider-name non-override in `docs/`; changelog note on the native-wins precedence change.
