# Test Plan — add-provider-models-refresh

Stage: design   Generated: 2026-10-12

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | crud › refresh endpoint | EP (valid) | L1 | automated | `providers.json` has `proxy`; probe stub returns `{ok:true,status:200,modelCount:7}` | `POST /api/providers/proxy/refresh` | 200 `{success:true, health:{ok:true,modelCount:7}}`; subsequent `GET /api/providers` → `health.proxy.modelCount === 7` |
| E2 | crud › refresh endpoint | EP (invalid) | L1 | automated | `providers.json` lacks `missing` | `POST /api/providers/missing/refresh` | 404; `piGateway.broadcast` not called; probe not called |
| E3 | crud › refresh endpoint | decision-table (corrupt file) | L1 | automated | `providers.json` = `"{not json"` | `POST /api/providers/proxy/refresh` | 409 with same body as PATCH corrupt refusal; no broadcast |
| E4 | crud › refresh endpoint (no write) | invariant | L1 | automated | valid `providers.json` with `proxy` | refresh | file bytes + mtime unchanged after request |
| E5 | crud › refresh endpoint (scoped broadcast) | EP | L1 | automated | `proxy` exists | refresh | `piGateway.broadcast` called once with `{type:"credentials_updated", refreshProviders:["proxy"]}` |
| E6 | crud › refresh endpoint (name encoding) | BVA (special chars) | L1 | automated | provider named `a/b` | `POST /api/providers/a%2Fb/refresh` | 200; broadcast `refreshProviders:["a/b"]` |
| E7 | crud › tiered + manifest-bound | invariant | L1 | automated | `route-tiers.ts`, `tools.denylist.ts` | `manifest-invariants.test.ts` completeness + tier lookup | entry `POST /api/providers/:name/refresh` tier `operate`; route denylisted |
| E8 | design D9 road classification | EP | L1 | automated | route pattern `/api/providers/:name/refresh` | `classifyHttpRoad("POST", …)` | resource family `providers` (non-identity, non-session) |
| E9 | registry › forced re-discovery | state-transition | L1 | automated | `proxy` registered (snapshot equal to `providers.json`); discovery stub now returns `[m1, new-model]` | `reloadProviders(pi, {force:["proxy"]})` | `pi.unregisterProvider("proxy")` then `pi.registerProvider("proxy", {models: [m1,new-model]})`; result `changed:["proxy"]` |
| E10 | registry › only named provider | decision-table | L1 | automated | `proxy` + `vllm` registered, both unchanged | `reloadProviders(pi, {force:["proxy"]})` | discovery fetch count === 1, URL = proxy baseUrl; `vllm` not unregistered |
| E11 | registry › unknown name ignored | EP (invalid) | L1 | automated | `missing` absent from `providers.json` | `reloadProviders(pi, {force:["missing"]})` | 0 fetches; returns `{added:[],removed:[],changed:[]}`; no throw |
| E12 | registry › plain notification unchanged | regression | L1 | automated | unchanged `providers.json` | `reloadProviders(pi)` (no force) | 0 fetches; empty diff |
| E13 | registry › endpoint model removed | state-transition | L1 | automated | `proxy` registered with `[m1, old-model]`; stub now `[m1]` | forced reload | `registerProvider` models omit `old-model` |
| E14 | registry › bridge path | integration | L1 | automated | bridge dispatch with mock registry + `reloadProviders` spy | `credentials_updated {refreshProviders:["proxy"]}` | `reloadProviders` called with `{force:["proxy"]}`; `models_list` pushed once |
| E15 | registry › bridge path (legacy msg) | regression | L1 | automated | same | `credentials_updated` without field | `reloadProviders` called with no force (or `force` empty) |
| E16 | client api › `refreshProviderModels` | EP | L1 | automated | fetch stub 200 `{success:true,health}` / 500 / network reject | `refreshProviderModels("a/b")` | URL `/api/providers/a%2Fb/refresh` POST; returns `{ok:true,health}` / `{ok:false,error}` / `{ok:false,error}` (never throws) |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | crud › row control | state-transition | L1 | automated | custom row `proxy`, cached health modelCount 3; refresh API deferred | click `provider-refresh-models` | button disabled + pill `testing`; resolve `{ok:true,health:{ok:true,modelCount:7}}` → pill shows 7, button enabled |
| F2 | crud › double activation | state-transition (illegal edge) | L1 | automated | refresh API deferred | click twice before resolve | API called exactly once |
| F3 | crud › funnel | invariant | L1 | automated | refresh resolves ok | click | exactly one `PROVIDER_AUTH_EVENT` dispatched + `onCredentialsChanged` called once |
| F4 | crud › row control hidden in edit | state-transition | L1 | automated | row in edit mode | click Edit | `provider-refresh-models` not rendered |
| F5 | crud › disabled while removing | decision-table | L1 | automated | `removePending` true | render | refresh button disabled |
| F6 | crud › row control (rendered) | convergence | L3 | automated | `page.route` `/api/providers` (row `edge-proxy`, health modelCount 3) + `/api/providers/edge-proxy/refresh` → `{success:true,health:{ok:true,modelCount:9,testedAt}}` | click Refresh models on `edge-proxy` row | row pill text converges to 9 models; button re-enabled |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | crud › unreachable endpoint | fault-injection (abort) | L1 | automated | probe stub `{ok:false,error:"ECONNREFUSED"}` | refresh route | 200 `{success:true,health:{ok:false,error:"ECONNREFUSED"}}`; broadcast still sent |
| X2 | crud › no key leakage | invariant | L1 | automated | provider apiKey `sk-SECRET123`; probe stub error message echoing upstream body | refresh route | response JSON string does not contain `sk-SECRET123` |
| X3 | crud › failure inline | fault-injection | L1 | automated | refresh API → `{ok:false,error:"boom"}` | click | inline error text `boom` on row; button enabled; pill keeps prior health |
| X4 | registry › register failure on forced reload | fault-injection | L1 | automated | `registerProvider` throws for `proxy` | forced reload | error logged; returns without throw; `vllm` untouched |
| X5 | crud › server registry refresh detached | fault-injection (delay) | L1 | automated | `refreshModelRegistry` never resolves | refresh route | response still returned (does not await registry refresh) |
| X6 | crud › unmount mid-flight | state-transition | L1 | automated | refresh API deferred | unmount section, then resolve | no React state-update warning; no event dispatched |

---

## Coverage summary

- Requirements covered: 4/4 (crud: endpoint, tier/manifest, row control; registry: forced re-discovery)
- Scenarios by class: edge 16 · perf 0 · frontend 6 · error 6
- Scenarios by level: L1 27 · L2 0 · L3 1
- Scenarios by disposition: automated 28 · manual-only 0

## New infra needed

- none
