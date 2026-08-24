# Test Plan — fix-custom-provider-model-metadata

Stage: design   Generated: 2026-08-19

HARD gate satisfied — 2 spec gaps were raised and answered before this file was written:

- **C1 (resolved)** — no performance scenario. Mapping is in-memory field copying dominated
  by the single HTTP fetch; correctness only. P-class is intentionally empty.
- **C2 (resolved)** — no upper sanity bound on advertised numerics. Any finite number > 0 is
  trusted; the provider is authoritative. Drives E9.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Discovery preserves advertised metadata | EP | L1 | automated | `{data:[{id:"cc/claude-opus-5",context_length:1000000,max_completion_tokens:128000,capabilities:{reasoning:true,vision:true}}]}` | metadata-preserving discovery runs | record reports contextWindow `1000000`, maxTokens `128000`, `reasoning:true`, `input` contains `"image"` |
| E2 | Ids-only helpers unchanged | EP | L1 | automated | same body as E1 | `listProviderModelIds` + `probeProvider` called | returns `string[]` of ids; probe returns `{ok,status,modelCount,sample}` with `sample.length<=5` |
| E3 | Mapping keyed on shape not api | decision-table | L1 | automated | provider `api:"anthropic-messages"`, body `{data:[{id,context_length:1000000,capabilities:{reasoning:true}}]}` | discovery maps metadata | ctx `1000000` + `reasoning:true` adopted (NOT floors) — proves api value did not gate mapping |
| E4 | Mapping keyed on shape not api | decision-table | L1 | automated | body `{models:[{name:"models/gemini-x",inputTokenLimit:1048576,outputTokenLimit:65536}]}` | discovery maps metadata | `gemini-x` reports ctx `1048576`, maxTokens `65536` |
| E5 | Top-level scalar wins over twin | decision-table | L1 | automated | model with `context_length:1000000` AND `capabilities.contextWindow:200000` | discovery maps metadata | mapped contextWindow is `1000000` |
| E6 | Top-level scalar wins over twin | decision-table | L1 | automated | model with only `capabilities.maxOutput:128000` (no `max_completion_tokens`) | discovery maps metadata | mapped maxTokens is `128000` (twin used as fallback) |
| E7 | Unrepresentable modalities dropped | decision-table | L1 | automated | `capabilities:{vision:true,pdf:true,audioInput:true,videoInput:true,imageOutput:true,audioOutput:true,search:true}` | discovery maps metadata | `input` is exactly `["text","image"]` |
| E8 | Per-field fallback | BVA | L1 | automated | `{id:"hybrid-model",capabilities:{reasoning:true}}`, no `context_length`; api floor 200000/64000 | discovery maps metadata | `reasoning:true` from endpoint AND contextWindow `200000` from floor, same record |
| E9 | Per-field fallback (malformed) | BVA | L1 | automated | four models with `context_length` = `"1000000"` (string), `0`, `-5`, `null`; plus one with `999999999999` | discovery maps metadata | first four fall to api floor; `999999999999` is ADOPTED (C2: no upper bound); no throw |
| E10 | Silent model unchanged | EP | L1 | automated | `{id:"bare-model"}` — no metadata fields | discovery maps metadata | full api-typed floors for that provider's api, byte-identical to pre-change values |
| E11 | thinkingLevelMap only when determined | decision-table | L1 | automated | `capabilities:{reasoning:true,thinkingFormat:"claude-adaptive",thinkingCanDisable:true,thinkingRange:null}` | discovery maps metadata | `reasoning:true` AND `thinkingLevelMap` ABSENT (not `{}`, not a guessed table) |
| E12 | Native outranks synthesis | decision-table | L1 | automated | model whose advertised thinking capability would determine a map; `models.json` declares a `thinkingLevelMap` for same `provider/id` | catalogue built | native `thinkingLevelMap` used |
| E13 | Native outranks endpoint | decision-table | L1 | automated | endpoint advertises `newapi/glm-5.2` ctx `200000`; `models.json` declares ctx `1000000` | catalogue built | reports ctx `1000000` |
| E14 | Endpoint beats floors (discovered-only) | decision-table | L1 | automated | endpoint advertises `newapi/other-model` ctx `1000000` + `reasoning:true`; no `models.json` entry | catalogue built | ctx `1000000`, `reasoning:true`; api floors NOT reported |
| E15 | Floors kept where endpoint silent | decision-table | L1 | automated | endpoint returns `newapi/other-model` with no capability fields; no `models.json` entry | catalogue built | retains api-typed floors (the narrowed original requirement) |
| E16 | Native-only survives outage | state-transition | L1 | automated | `/v1/models` unavailable; `models.json` declares `newapi/glm-5.2` | catalogue built | present with native metadata; `baseUrl`/`api` from `providers.json#providers.newapi` |
| E17 | Built-in metadata untouched | EP | L1 | automated | catalogue containing `anthropic/claude-opus-4-8` + a custom provider | custom discovery runs | built-in model's metadata identical to pre-change snapshot |
| E18 | Built-in wins collision | decision-table | L1 | automated | custom provider advertises an id colliding with a built-in `provider/id` | catalogue built | built-in pi-ai model retains precedence |
| E19 | metadataSource endpoint | decision-table | L1 | automated | model whose ctx+maxTokens+reasoning all came from endpoint | metadata projected | `metadataSource === "endpoint"` |
| E20 | metadataSource weakest tier | decision-table | L1 | automated | model with `reasoning` from endpoint, ctx from floor | metadata projected | `metadataSource === "fallback"` |
| E21 | In-session endpoint beats catalog guess | decision-table | L1 | automated | provider advertises `ag/claude-opus-4-6-thinking` ctx `200000`; pi catalog would name-match `claude-opus-4-6` at `1000000` | extension enriches | reports ctx `200000` |
| E22 | Catalog still fills unadvertised | decision-table | L1 | automated | custom model advertising no `context_length`; pi catalog has a match for its id | extension enriches | catalog value used for contextWindow (tier 3 intact) |
| E23 | No credential leak | EP | L1 | automated | provider with resolved apiKey; full metadata preserved | `/api/models` served + discovery logs written | neither contains the apiKey; response contains no raw `compat` |

### Performance

Intentionally empty — see C1. Mapping is in-memory field copying dominated by the single
HTTP fetch already performed; no threshold exists to falsify.

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | Endpoint provenance rendered as confirmed | state-convergence | L3 | automated | dashboard with a custom provider advertising ctx `1000000` + `reasoning:true` for a model | open the model selector | that row converges to showing the 1M context value AND does NOT carry the "uncertain" capability treatment |
| F2 | Fallback provenance still uncertain | state-transition | L3 | automated | custom provider whose model advertises nothing | open the model selector | that row still renders the muted/uncertain capability icons (no regression of existing behaviour) |
| F3 | metadataSource union widening is non-breaking | decision-table | L1 | automated | model props with `metadataSource` `"catalog"`, `"endpoint"`, `"fallback"`, and `undefined` | `ModelSelector` renders each | no crash; `"catalog"`/`"fallback"`/`undefined` branches behave exactly as before |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Discovery degrades gracefully | fault-injection (abort) | L1 | automated | `/v1/models` returns HTTP 500 | metadata-preserving discovery runs | no models for that provider; no throw |
| X2 | Discovery degrades gracefully | fault-injection (delay) | L1 | automated | `/v1/models` never responds past the discovery timeout | discovery runs | aborts at the existing timeout; returns no models; no throw; no unhandled rejection |
| X3 | Discovery degrades gracefully | fault-injection | L1 | automated | body is not JSON / is `{}` / is `{data:"nope"}` | discovery runs | returns no models for that provider; no throw |
| X4 | One bad provider cannot break the catalogue | fault-injection (abort) | L1 | automated | two custom providers, first returns HTTP 500, second returns valid rich metadata | catalogue built | second provider's models present with advertised metadata |
| X5 | Unresolvable api key | fault-injection | L1 | automated | provider whose `apiKey` is `$MISSING_ENV` | discovery runs | no models for that provider; no throw; no credential string in the error path |

---

## Coverage summary

- Requirements covered: 10/10 (6 ADDED + 2 MODIFIED requirement bodies + the 2 precedence
  rules they define)
- Scenarios by class: edge 23 · perf 0 · frontend 3 · error 5
- Scenarios by level: L1 29 · L2 0 · L3 2
- Scenarios by disposition: automated 31 · manual-only 0

## New infra needed

None. Every scenario extends an existing harness:

- L1 server merge/precedence → `packages/server/src/model-proxy/__tests__/internal-registry-native-merge.test.ts`
- L1 server discovery/probe → new sibling in `packages/server/src/package/__tests__/` (dir exists)
- L1 extension enrichment → `packages/extension/src/__tests__/enrich-model-metadata.test.ts`
- L1 extension thinking levels → `packages/extension/src/__tests__/provider-register-thinking-levels.test.ts`
- L1 client selector → `packages/client/src/components/__tests__/ModelSelector.test.tsx`
- L3 selector behaviour → `tests/e2e/model-selector-reload-on-open.spec.ts`
