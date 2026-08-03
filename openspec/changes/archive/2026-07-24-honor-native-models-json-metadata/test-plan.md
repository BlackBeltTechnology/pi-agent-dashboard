# Test Plan — honor-native-models-json-metadata

Stage: design   Generated: 2026-07-24

All scenario Triples are fillable from the specs — no clarifications needed.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | shared reader flattens nested (D-X2 / server "read native nested") | EP | L1 | automated | `models.json` = `{providers:{newapi:{models:[{id:"glm-5.2",contextWindow:200000,maxTokens:65536,reasoning:true,thinkingLevelMap:{...},compat:{...},input:["text","image"],cost:{...}}]}}}` | shared reader runs | one `CustomModelEntry` `provider:"newapi", id:"glm-5.2"` carrying all seven fields |
| E2 | parent key wins over in-entry provider | decision-table | L1 | automated | nested entry under `newapi` whose object also has `provider:"other"` | reader flattens | stamped `provider:"newapi"` (parent), not `"other"` |
| E3 | legacy shapes still parse; nested wins on collision | EP | L1 | automated | top-level `[{provider:"newapi",id:"glm-5.2",maxTokens:8192}]` AND nested `newapi.glm-5.2 maxTokens:65536` | reader runs | single `newapi/glm-5.2` with `maxTokens:65536` (nested wins) |
| E4 | native wins over discovery fallback (field merge, S-①/S-③) | decision-table | L1 | automated | discovered `newapi/glm-5.2` fallback (ctx 128000/max 16384/reasoning false/input ["text"]/cost 0) + native entry (ctx 200000/max 65536/reasoning true/map/input ["text","image"]/cost>0) | `getAllModels()` | merged model: ctx 200000, max 65536, reasoning true, native map+input+cost; `baseUrl/api/oauthCompatible` from discovery |
| E5 | native-only entry surfaces (outer join, AC5) | BVA | L1 | automated | discovery returns `[]` for `newapi`; native declares `newapi/glm-5.2`; `providers.json` has `newapi.baseUrl` | `getAllModels()` | `newapi/glm-5.2` present, routing from `providers.json` |
| E6 | discovered-only keeps fallback floors | EP | L1 | automated | discovered `newapi/other`; no native entry | `getAllModels()` | `newapi/other` keeps ctx 128000/max 16384 |
| E7 | built-in wins over custom under built-in name | decision-table | L1 | automated | native entry under `providers.anthropic.models[]` colliding a built-in `anthropic/<id>` | `getAllModels()` | built-in model retained; custom entry does not override |
| E8 | oauthCompatible never taken from native | decision-table | L1 | automated | native entry (no `oauthCompatible`) for an oauth-incompatible discovered id | `getAllModels()` | `oauthCompatible` stays from discovery/`isOauthIncompatible`, not defaulted true |
| E9 | extension registers UNION of discovered + native ids (I6/E-①) | EP | L1 | automated | `/v1/models` → `[a]`; `providers.newapi.models[]` → `[a,b]` | `registerEntry("newapi")` | `pi.registerProvider` models = `{a,b}`; `b` present though undiscovered |
| E10 | extension native metadata precedence (E-②) | decision-table | L1 | automated | discovered `glm-5.2` + native entry with map+compat | `registerEntry` | descriptor carries native ctx/max/reasoning/map/compat/input/cost, not fallback |
| E11 | derivation `max` opt-in + runtime-gated, fail-closed (I1) | decision-table | L1 | automated | synthetic `{max:"max", others:null}` reasoning model | `deriveSupportedThinkingLevels(true,map,maxSupported)` | `maxSupported=true`→`["off","max"]`; `maxSupported=false`→`["off"]`; map omits `max`→never `max` |
| E12 | ThinkingLevelSelector renders max only when supported (⑤) | EP | L1 | automated | `supportedLevels=["off","max"]` vs `undefined` | component render | renders `max` in first; fallback (undefined) renders six, no `max` |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | thinkingLevelMap flows extension→models_list→selector | state-convergence | L1 | automated | `newapi/glm-5.2` registered with native map | `toModelInfo` → `ModelInfo` | `supportedThinkingLevels` derived from native map; selector would render exactly those |
| F2 | end-to-end `max` in web UI on a max-capable pi | state-transition | — | manual-only | real `providers.newapi.models[]` with `thinkingLevelMap.max` on pi 0.80.10 harness | user opens thinking selector for `newapi/glm-5.2` | `max` appears + is selectable [needs real max-capable runtime + provider — no automatable observable in the pinned harness] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | malformed models.json is defensive, per-provider (S-②/D-S1) | fault-injection | L1 | automated | `providers.newapi.models` not an array (or file syntactically invalid) | shared reader / `readModels` | `[]` for that block, no throw, other providers still read; `console.warn` on parse failure |
| X2 | extension falls back when models.json malformed | fault-injection | L1 | automated | invalid `models.json` during `registerEntry` | `registerEntry("newapi")` | falls back to enrichment without throwing; other providers register |
| X3 | discovery outage keeps routing working (AC5) | fault-injection (abort) | L1 | automated | `/v1/models` unreachable | server `getAllModels()` + extension `registerEntry` | native-declared models still surface on both paths |

### Security

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| S1 | no credentials + no compat over /api/models (AC6, S-④) | decision-table | L1 | automated | `newapi` with apiKey + native `compat` | `GET /api/models` (default AND `?annotated=1`) | rows carry raw `thinkingLevelMap`; NO `compat`, NO `apiKey`/credential, NO server-derived `supportedThinkingLevels` |
| S2 | compat carried on registry model for routing | decision-table | L1 | automated | native `compat:{thinkingFormat:"deepseek"}` | build registry model | built model carries `compat` (streamSimple can format); still absent from `/api/models` (S1) |

---

## Coverage summary

- Requirements covered: 3 specs / all delta requirements
- Scenarios by class: edge 12 · perf 0 · frontend 2 · error 3 · security 2
- Scenarios by level: L1 18 · L2 0 · L3 0 · manual-only 1
- Scenarios by disposition: automated 18 · manual-only 1

## New infra needed

- none (all L1 in existing vitest suites: `packages/server/src/model-proxy/__tests__/`,
  `packages/extension/src/__tests__/`, `packages/client/src/__tests__/`, plus a shared-reader
  test in the shared package). F2 defers to post-merge manual verification.
