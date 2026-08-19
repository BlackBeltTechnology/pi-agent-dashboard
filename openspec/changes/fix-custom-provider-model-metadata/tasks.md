# Tasks — fix-custom-provider-model-metadata

## 1. Ingestion — preserve the provider response

- [ ] 1.1 Add a metadata-preserving model-discovery function in `packages/server/src/package/provider-probe.ts` returning per-model records (id + advertised capability fields), reusing `buildProbeRequest` unchanged. Leave `extractModelIds`, `listProviderModelIds`, and `probeProvider` behaviourally untouched.
- [ ] 1.2 Implement shape-keyed mapping (OpenAI-ish `body.data[]` / Google-ish `body.models[]`), mirroring how `extractModelIds` already branches on the body rather than the configured `api`.
- [ ] 1.3 Implement per-field adoption + validation: a field counts as advertised only when present and well-typed, and numeric capacity fields must be a finite number > 0. No upper sanity bound — an absurd-but-finite value is adopted (test-plan C2).
- [ ] 1.4 Implement the twin-conflict rule: `context_length` wins over `capabilities.contextWindow`, `max_completion_tokens` wins over `capabilities.maxOutput`.
- [ ] 1.5 Map `capabilities.vision` → `"image"` in `input`; drop `pdf`/`audioInput`/`videoInput`/`imageOutput`/`audioOutput`/`search` rather than widening the `input` type.

## 2. Server registry — consume preserved metadata

- [ ] 2.1 Rework `packages/server/src/model-proxy/custom-provider-discovery.ts` to consume the preserving function; turn the `FALLBACK` record from an unconditional per-model stamp into a per-field default applied only where the endpoint was silent.
- [ ] 2.2 Insert the endpoint tier into the merge ladder in `packages/server/src/model-proxy/internal-registry.ts`: native `models.json` → endpoint-advertised → api-typed floor. Preserve the existing native-wins and built-in-wins rules exactly.
- [ ] 2.3 Adopt endpoint `reasoning`; synthesize `thinkingLevelMap` only when the advertised thinking capability determines it, leaving it absent for `thinkingRange: null` / missing `thinkingFormat`.

## 3. Provenance

- [ ] 3.1 Widen `metadataSource` to `"catalog" | "endpoint" | "fallback"` in `packages/shared/src/types.ts` and `packages/extension/src/provider-register.ts`.
- [ ] 3.2 Stamp provenance by weakest adopted tier so a mixed-tier model is never reported as fully confirmed.
- [ ] 3.3 Handle `"endpoint"` in `packages/client/src/components/settings/ModelSelector.tsx` as confirmed capability, keeping the existing uncertain treatment for `"fallback"` only.

## 4. In-session extension surface

- [ ] 4.1 Widen `DiscoveredModel` in `packages/extension/src/provider-register.ts` beyond `{ id, owned_by }` and stop discarding the advertised fields in `discoverModels`.
- [ ] 4.2 Rank advertised metadata above the name-matched catalog probe in `enrichModelMetadata`, keeping the catalog probe as the tier for fields the provider did not advertise.

## 5. Tests — L1 ingestion + mapping

- [ ] 5.1 Advertised metadata survives discovery — see `packages/server/src/package/__tests__/` (new sibling; copy harness glue from `packages/server/src/model-proxy/__tests__/internal-registry.test.ts`). Triple: `{data:[{id:"cc/claude-opus-5",context_length:1000000,max_completion_tokens:128000,capabilities:{reasoning:true,vision:true}}]}` · discovery runs · record reports ctx 1000000, maxTokens 128000, reasoning true, input contains "image" (test-plan #E1)
- [ ] 5.2 Ids-only helpers unchanged — see `packages/server/src/model-proxy/__tests__/internal-registry.test.ts`. Triple: same body as #E1 · `listProviderModelIds` + `probeProvider` called · returns `string[]`; probe returns `{ok,status,modelCount,sample}` with sample capped at 5 (test-plan #E2)
- [ ] 5.3 Mapping keyed on response shape, not configured api — see `packages/server/src/model-proxy/__tests__/internal-registry-native-merge.test.ts`. Triple: provider `api:"anthropic-messages"` returning `{data:[{id,context_length:1000000,capabilities:{reasoning:true}}]}` · discovery maps metadata · ctx 1000000 + reasoning true adopted, floors not used (test-plan #E3)
- [ ] 5.4 Google-shaped body mapped — see `packages/server/src/model-proxy/__tests__/internal-registry-native-merge.test.ts`. Triple: `{models:[{name:"models/gemini-x",inputTokenLimit:1048576,outputTokenLimit:65536}]}` · discovery maps metadata · gemini-x reports ctx 1048576, maxTokens 65536 (test-plan #E4)
- [ ] 5.5 Top-level scalar wins over capabilities twin — see `packages/server/src/model-proxy/__tests__/internal-registry-native-merge.test.ts`. Triple: `context_length:1000000` AND `capabilities.contextWindow:200000` · discovery maps metadata · mapped contextWindow is 1000000 (test-plan #E5)
- [ ] 5.6 Twin used as fallback when scalar absent — see `packages/server/src/model-proxy/__tests__/internal-registry-native-merge.test.ts`. Triple: only `capabilities.maxOutput:128000` · discovery maps metadata · mapped maxTokens is 128000 (test-plan #E6)
- [ ] 5.7 Unrepresentable modalities dropped — see `packages/extension/src/__tests__/enrich-model-metadata.test.ts`. Triple: `capabilities:{vision:true,pdf:true,audioInput:true,videoInput:true,imageOutput:true,audioOutput:true,search:true}` · discovery maps metadata · input is exactly `["text","image"]` (test-plan #E7)
- [ ] 5.8 Per-field fallback keeps advertised fields — see `packages/server/src/model-proxy/__tests__/internal-registry-native-merge.test.ts`. Triple: `{id:"hybrid-model",capabilities:{reasoning:true}}` with no `context_length`, api floor 200000/64000 · discovery maps metadata · same record has reasoning true from endpoint AND ctx 200000 from floor (test-plan #E8)
- [ ] 5.9 Malformed values fall to floor; absurd finite value adopted — see `packages/server/src/model-proxy/__tests__/internal-registry-native-merge.test.ts`. Triple: `context_length` of `"1000000"`, `0`, `-5`, `null`, and `999999999999` · discovery maps metadata · first four use api floor, `999999999999` adopted, no throw (test-plan #E9)
- [ ] 5.10 Silent model identical to today — see `packages/server/src/model-proxy/__tests__/internal-registry.test.ts`. Triple: `{id:"bare-model"}` with no metadata fields · discovery maps metadata · full api-typed floors for that api (test-plan #E10)

## 6. Tests — L1 thinking levels + precedence

- [ ] 6.1 thinkingLevelMap absent when underdetermined — see `packages/extension/src/__tests__/provider-register-thinking-levels.test.ts`. Triple: `capabilities:{reasoning:true,thinkingFormat:"claude-adaptive",thinkingCanDisable:true,thinkingRange:null}` · discovery maps metadata · reasoning true AND thinkingLevelMap absent, not `{}` and not a guessed table (test-plan #E11)
- [ ] 6.2 Native thinkingLevelMap outranks synthesis — see `packages/extension/src/__tests__/provider-register-native-models.test.ts`. Triple: advertised thinking capability that would determine a map + `models.json` declaring a map for the same `provider/id` · catalogue built · native map used (test-plan #E12)
- [ ] 6.3 Native ctx outranks endpoint ctx — see `packages/server/src/model-proxy/__tests__/internal-registry-native-merge.test.ts`. Triple: endpoint advertises `newapi/glm-5.2` ctx 200000, `models.json` declares ctx 1000000 · catalogue built · reports ctx 1000000 (test-plan #E13)
- [ ] 6.4 Endpoint beats floors for discovered-only model — see `packages/server/src/model-proxy/__tests__/internal-registry-native-merge.test.ts`. Triple: endpoint advertises `newapi/other-model` ctx 1000000 + reasoning true, no `models.json` entry · catalogue built · ctx 1000000 + reasoning true, floors not reported (test-plan #E14)
- [ ] 6.5 Floors retained where endpoint silent (narrowed original requirement) — see `packages/server/src/model-proxy/__tests__/internal-registry-native-merge.test.ts`. Triple: endpoint returns `newapi/other-model` with no capability fields, no `models.json` entry · catalogue built · retains api-typed floors (test-plan #E15)
- [ ] 6.6 Native-only entry survives discovery outage — see `packages/server/src/model-proxy/__tests__/read-native-models.test.ts`. Triple: `/v1/models` unavailable + `models.json` declares `newapi/glm-5.2` · catalogue built · present with native metadata, baseUrl/api from `providers.json#providers.newapi` (test-plan #E16)

## 7. Tests — L1 built-in containment + provenance + in-session

- [ ] 7.1 Built-in model metadata untouched — see `packages/server/src/model-proxy/__tests__/internal-registry.test.ts`. Triple: catalogue with `anthropic/claude-opus-4-8` + a custom provider · custom discovery runs · built-in metadata identical to pre-change snapshot (test-plan #E17)
- [ ] 7.2 Built-in wins id collision — see `packages/server/src/model-proxy/__tests__/internal-registry-native-merge.test.ts`. Triple: custom provider advertising an id colliding with a built-in `provider/id` · catalogue built · built-in retains precedence (test-plan #E18)
- [ ] 7.3 metadataSource endpoint for fully-advertised model — see `packages/extension/src/__tests__/enrich-model-metadata.test.ts`. Triple: model whose ctx+maxTokens+reasoning all came from endpoint · metadata projected · `metadataSource === "endpoint"` (test-plan #E19)
- [ ] 7.4 metadataSource reports weakest tier — see `packages/extension/src/__tests__/enrich-model-metadata.test.ts`. Triple: reasoning from endpoint, ctx from floor · metadata projected · `metadataSource === "fallback"` (test-plan #E20)
- [ ] 7.5 In-session endpoint beats catalog name-match — see `packages/extension/src/__tests__/enrich-model-metadata.test.ts`. Triple: provider advertises `ag/claude-opus-4-6-thinking` ctx 200000 while pi catalog would name-match `claude-opus-4-6` at 1000000 · extension enriches · reports ctx 200000 (test-plan #E21)
- [ ] 7.6 Catalog probe still fills unadvertised fields — see `packages/extension/src/__tests__/enrich-model-metadata.test.ts`. Triple: custom model advertising no `context_length` with a pi-catalog match for its id · extension enriches · catalog value used for contextWindow (test-plan #E22)
- [ ] 7.7 No credential leak through preserved metadata — see `packages/extension/src/__tests__/custom-provider-apikey-roundtrip.test.ts`. Triple: provider with resolved apiKey, full metadata preserved · `/api/models` served + discovery logs written · neither contains the apiKey, response has no raw `compat` (test-plan #E23)
- [ ] 7.8 metadataSource union widening is non-breaking — see `packages/client/src/components/__tests__/ModelSelector.test.tsx`. Triple: props with `metadataSource` `"catalog"`, `"endpoint"`, `"fallback"`, `undefined` · ModelSelector renders each · no crash; pre-existing branches behave as before (test-plan #F3)

## 8. Tests — L1 error handling

- [ ] 8.1 HTTP 500 degrades gracefully — see `packages/server/src/model-proxy/__tests__/internal-registry.test.ts`. Triple: `/v1/models` returns HTTP 500 · discovery runs · no models for that provider, no throw (test-plan #X1)
- [ ] 8.2 Timeout degrades gracefully — see `packages/extension/src/__tests__/model-refresh-timeout.test.ts`. Triple: `/v1/models` never responds past the discovery timeout · discovery runs · aborts at existing timeout, no models, no throw, no unhandled rejection (test-plan #X2)
- [ ] 8.3 Malformed body degrades gracefully — see `packages/server/src/model-proxy/__tests__/read-native-models.test.ts`. Triple: body is not JSON / `{}` / `{data:"nope"}` · discovery runs · no models for that provider, no throw (test-plan #X3)
- [ ] 8.4 One bad provider cannot break the catalogue — see `packages/server/src/model-proxy/__tests__/internal-registry.test.ts`. Triple: two custom providers, first HTTP 500, second valid rich metadata · catalogue built · second provider's models present with advertised metadata (test-plan #X4)
- [ ] 8.5 Unresolvable api key degrades gracefully — see `packages/extension/src/__tests__/custom-provider-apikey-roundtrip.test.ts`. Triple: provider whose `apiKey` is `$MISSING_ENV` · discovery runs · no models, no throw, no credential string in the error path (test-plan #X5)

## 9. Tests — L3 rendered UI

- [ ] 9.1 Endpoint provenance renders as confirmed — see `tests/e2e/model-selector-reload-on-open.spec.ts`. Triple: dashboard with a custom provider advertising ctx 1000000 + reasoning true · open the model selector · that row converges to the 1M context value and carries no "uncertain" capability treatment (test-plan #F1)
- [ ] 9.2 Fallback provenance still uncertain — see `tests/e2e/empty-model-selector.spec.ts`. Triple: custom provider whose model advertises nothing · open the model selector · that row still renders muted/uncertain capability icons (test-plan #F2)

## 10. Validate

- [ ] 10.1 `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` then grep the summary pattern; all suites green.
- [ ] 10.2 `npm run quality:changed` clean on the touched files.
- [ ] 10.3 Rebuild per the matrix: `/api/restart` for shared+server, `npm run reload` for extension, `npm run build` + restart for client.
- [ ] 10.4 Verify against the real provider: the configured 9router `proxy` provider reports `cc/claude-opus-5` at ctx 1000000 / maxTokens 128000 / reasoning true in the model selector, and the 3 bare-id hybrids still render without error.
