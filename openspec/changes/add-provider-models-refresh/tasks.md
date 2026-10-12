## 1. Protocol + route registration

- [ ] 1.1 Add optional `refreshProviders?: string[]` to `CredentialsUpdatedMessage` in `packages/shared/src/protocol.ts`; verify `npx tsc --noEmit -p packages/shared` passes
- [ ] 1.2 Add `{ method: "POST", path: "/api/providers/:name/refresh", tier: "operate" }` to `packages/shared/src/route-tiers.ts` and a denylist row (reason: UI-only models-refresh trigger) in `packages/mcp-server-plugin/src/server/tools.denylist.ts`; verify via 1.3 and 1.4
- [ ] 1.3 Test — tier + manifest completeness covers the new route: input `route-tiers.ts` + `tools.denylist.ts` · trigger completeness check · observable tier `operate` and route denylisted. Exemplar: `packages/mcp-server-plugin/src/server/__tests__/manifest-invariants.test.ts` (test-plan #E7)
- [ ] 1.4 Test — road classification: input pattern `/api/providers/:name/refresh` · trigger `classifyHttpRoad("POST", …)` · observable resource family `providers`. Exemplar: `packages/server/src/identity/__tests__/http-road-classification.test.ts` (test-plan #E8)

## 2. Extension — forced re-register

- [ ] 2.1 Test — forced reload re-registers with fresh discovery: input `proxy` registered, discovery stub now `[m1,new-model]` · trigger `reloadProviders(pi,{force:["proxy"]})` · observable unregister then `registerProvider` with both models, `changed:["proxy"]`. Exemplar: `packages/extension/src/__tests__/provider-register-reload.test.ts` (test-plan #E9)
- [ ] 2.2 Test — only the named provider is re-discovered: input `proxy`+`vllm` unchanged · trigger force `["proxy"]` · observable 1 fetch to proxy baseUrl, `vllm` not unregistered. Exemplar: `packages/extension/src/__tests__/provider-register-reload.test.ts` (test-plan #E10)
- [ ] 2.3 Test — unknown forced name ignored: input `missing` absent · trigger force `["missing"]` · observable 0 fetches, empty diff, no throw. Exemplar: `packages/extension/src/__tests__/provider-register-reload.test.ts` (test-plan #E11)
- [ ] 2.4 Test — plain reload unchanged: input unchanged `providers.json` · trigger `reloadProviders(pi)` · observable 0 fetches, empty diff. Exemplar: `packages/extension/src/__tests__/provider-register-reload.test.ts` (test-plan #E12)
- [ ] 2.5 Test — removed endpoint model drops out: input registered `[m1,old-model]`, stub `[m1]` · trigger forced reload · observable registered models omit `old-model`. Exemplar: `packages/extension/src/__tests__/provider-register-reload.test.ts` (test-plan #E13)
- [ ] 2.6 Test — register failure on forced reload: input `registerProvider` throws for `proxy` · trigger forced reload · observable error logged, no throw, `vllm` untouched. Exemplar: `packages/extension/src/__tests__/provider-register-reload.test.ts` (test-plan #X4)
- [ ] 2.7 Implement `reloadProviders(pi, { force?: string[] })` in `packages/extension/src/provider-register.ts` (forced name in snapshot + current → changed branch; via `reloadChain`); verify 2.1–2.6 pass
- [ ] 2.8 Test — bridge passes the scope: input dispatch with `reloadProviders` spy · trigger `credentials_updated {refreshProviders:["proxy"]}` · observable spy called with `{force:["proxy"]}`, one `models_list` push. Exemplar: `packages/extension/src/__tests__/credentials-updated.test.ts` (test-plan #E14)
- [ ] 2.9 Test — legacy message unchanged: input same · trigger `credentials_updated` without field · observable reload called without forced names. Exemplar: `packages/extension/src/__tests__/credentials-updated.test.ts` (test-plan #E15)
- [ ] 2.10 Implement pass-through in `packages/extension/src/bridge-handlers/dispatch.ts` + log forced names (no secrets); verify 2.8–2.9 pass

## 3. Server — refresh endpoint

- [ ] 3.1 Test — refresh returns fresh health: input `proxy` exists, probe stub modelCount 7 · trigger `POST /api/providers/proxy/refresh` · observable 200 `{success:true,health.modelCount:7}`, cached in `GET /api/providers`. Exemplar: `packages/server/src/__tests__/provider-routes-single-provider.test.ts` (test-plan #E1)
- [ ] 3.2 Test — unknown provider: input `missing` absent · trigger refresh · observable 404, no broadcast, no probe. Exemplar: `packages/server/src/__tests__/provider-routes-single-provider.test.ts` (test-plan #E2)
- [ ] 3.3 Test — corrupt file: input `providers.json` unparseable · trigger refresh · observable 409 same body as PATCH refusal, no broadcast. Exemplar: `packages/server/src/__tests__/provider-routes-corrupt-file.test.ts` (test-plan #E3)
- [ ] 3.4 Test — no write: input valid file · trigger refresh · observable bytes + mtime unchanged. Exemplar: `packages/server/src/__tests__/provider-routes-single-provider.test.ts` (test-plan #E4)
- [ ] 3.5 Test — scoped broadcast: input `proxy` exists · trigger refresh · observable broadcast once `{type:"credentials_updated",refreshProviders:["proxy"]}`. Exemplar: `packages/server/src/__tests__/provider-routes-single-provider.test.ts` (test-plan #E5)
- [ ] 3.6 Test — encoded name: input provider `a/b` · trigger `POST /api/providers/a%2Fb/refresh` · observable 200, broadcast `["a/b"]`. Exemplar: `packages/server/src/__tests__/provider-routes-single-provider.test.ts` (test-plan #E6)
- [ ] 3.7 Test — unreachable endpoint: input probe `{ok:false,error:"ECONNREFUSED"}` · trigger refresh · observable 200 with `health.ok:false` + error, broadcast sent. Exemplar: `packages/server/src/__tests__/provider-health-cache-route.test.ts` (test-plan #X1)
- [ ] 3.8 Test — no key leakage: input apiKey `sk-SECRET123`, probe error echoes upstream body · trigger refresh · observable response JSON lacks `sk-SECRET123`. Exemplar: `packages/server/src/__tests__/provider-test-route.test.ts` (test-plan #X2)
- [ ] 3.9 Test — registry refresh detached: input `refreshModelRegistry` never resolves · trigger refresh · observable response returned. Exemplar: `packages/server/src/__tests__/provider-routes-single-provider.test.ts` (test-plan #X5)
- [ ] 3.10 Implement `POST /api/providers/:name/refresh` in `packages/server/src/routes/provider-routes.ts` (corrupt → 409, unknown → 404, broadcast, detached registry refresh, awaited probe+cache, `{success, health}`); verify 3.1–3.9 pass

## 4. Client — Refresh models button

- [ ] 4.1 Test — `refreshProviderModels`: input fetch stub 200 / 500 / reject · trigger `refreshProviderModels("a/b")` · observable POST `/api/providers/a%2Fb/refresh`; `{ok:true,health}` / `{ok:false,error}` / `{ok:false,error}`, never throws. Exemplar: `packages/client/src/lib/api/__tests__/api-base-fetch.test.ts` (test-plan #E16)
- [ ] 4.2 Implement `refreshProviderModels(name)` in `packages/client/src/lib/api/providers-api.ts`; verify 4.1 passes
- [ ] 4.3 Test — row refresh state machine: input row `proxy` cached 3, API deferred · trigger click `provider-refresh-models` · observable disabled + testing pill, then pill 7, re-enabled. Exemplar: `packages/client/src/__tests__/ProviderAuthSection.test.tsx` (test-plan #F1)
- [ ] 4.4 Test — double click: input API deferred · trigger two clicks · observable API called once. Exemplar: `packages/client/src/__tests__/ProviderAuthSection.test.tsx` (test-plan #F2)
- [ ] 4.5 Test — funnel: input refresh ok · trigger click · observable one `PROVIDER_AUTH_EVENT` + one `onCredentialsChanged`. Exemplar: `packages/client/src/__tests__/ProviderAuthSection.test.tsx` (test-plan #F3)
- [ ] 4.6 Test — hidden in edit: input row editing · trigger click Edit · observable no `provider-refresh-models`. Exemplar: `packages/client/src/__tests__/ProviderAuthSection.test.tsx` (test-plan #F4)
- [ ] 4.7 Test — disabled while removing: input removal pending · trigger render · observable button disabled. Exemplar: `packages/client/src/__tests__/ProviderAuthSection.test.tsx` (test-plan #F5)
- [ ] 4.8 Test — failure inline: input API `{ok:false,error:"boom"}` · trigger click · observable inline `boom`, enabled, prior pill kept. Exemplar: `packages/client/src/__tests__/ProviderAuthSection.test.tsx` (test-plan #X3)
- [ ] 4.9 Test — unmount mid-flight: input API deferred · trigger unmount then resolve · observable no state-update warning, no event. Exemplar: `packages/client/src/__tests__/ProviderAuthSection.test.tsx` (test-plan #X6)
- [ ] 4.10 Implement Refresh models button on `CustomEndpointRow` (`ProviderAuthSection.tsx`) + i18n keys `providers.refreshModels` / `providers.refreshingModels` in `i18n-en-source.json`, `i18n-hu.ts`, `i18n.tsx` (zh); verify 4.3–4.9 pass
- [ ] 4.11 Test — rendered row converges: input `page.route` `/api/providers` (`edge-proxy`, modelCount 3) + `/api/providers/edge-proxy/refresh` → modelCount 9 · trigger click Refresh models · observable pill converges to 9, button re-enabled. Exemplar: `tests/e2e/redesign-providers-list.spec.ts` (test-plan #F6)

## 5. Docs + closeout

- [ ] 5.1 Update AGENTS.md rows (`provider-routes.ts`, `provider-register.ts`, `ProviderAuthSection.tsx`, `providers-api.ts`, `bridge-handlers/dispatch.ts`, `tools.denylist.ts`) with `See change: add-provider-models-refresh`; verify `rg 'add-provider-models-refresh' -g 'AGENTS.md'` lists each
- [ ] 5.2 Run `npm test` and `npm run quality:changed`; verify green
