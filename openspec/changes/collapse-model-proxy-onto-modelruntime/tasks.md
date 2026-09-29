## 1. Credential store

- [ ] 1.1 Re-point the `model-proxy-credential-routing` coordination tests (fresher on-disk adoption, waiting out a pi refresh, CAS outcomes, corrupt/absent file, persist contention) at a `CredentialStore.modify()` driven the way pi-ai `resolveStoredOAuth` drives it; verify they fail before the adapter exists
- [ ] 1.2 Implement `packages/server/src/auth/dashboard-credential-store.ts` (`read`/`list`/`modify`/`delete`) over `provider-auth-storage.ts`, with per-provider single-flight; verify task 1.1 tests pass
- [ ] 1.3 Add a lock-not-held-during-network test (a second process acquires the lock while a fake 5s refresh runs) and a crash-during-persist test (atomic replace); verify both pass
- [ ] 1.4 Add a non-idempotent-callback contract test that a lost race never persists; verify it passes

## 2. Single runtime

- [ ] 2.1 Create one server `ModelRuntime` with the store (`refreshOnCreate:false`, `allowModelNetwork:false`) behind the existing `getModelRegistry()` accessor; verify `/api/models` output is unchanged against a recorded fixture
- [ ] 2.2 Register `providers.json` custom providers with `runtime.registerProvider` (using `custom-provider-discovery.ts`); re-register on change; verify custom-provider proxy completions pass end to end
- [ ] 2.3 Switch the proxy streamer to `runtime.streamSimple`; map wrapped store errors to the named outcomes (D2); verify the full model-proxy suite (tools, system prompt, abort, mid-stream failure, concurrency) passes
- [ ] 2.4 Point `provider-auth-registry.ts` at the same runtime and delete `EMPTY_READONLY_STORE`; verify the provider-auth OAuth flow listing is unchanged
- [ ] 2.5 Verify `PluginModelRuntime.getModelRegistry()` consumers (`system-one-plugin` `llm-caller.ts`) work end to end

## 3. Removal

- [ ] 3.1 Delete `packages/shared/src/piai-compat/` and `test-support/piai-factory-fixture.ts`; remove the dead registry/refresh code from `internal-registry.ts` / `internal-auth-storage.ts`; verify `rg -n 'piai-compat|adaptPiAi' packages` is empty and `npm test` is green
- [ ] 3.2 Decide `provider-catalogue-cache.ts` per D4; delete it if redundant, otherwise record it as follow-up; verify the providers settings page renders unchanged

## 4. Verification and docs

- [ ] 4.1 Real-credential smoke: an OAuth provider (e.g. Anthropic subscription) with a near-expiry token refreshes once through the proxy while a pi session is running; `auth.json` stays valid; verify with `/v1/chat/completions` and pi still working
- [ ] 4.2 Run the Audit subagent on the diff (credential routing); fix its findings
- [ ] 4.3 DocScribe: update the `docs/architecture.md` model-proxy and pi-ai window sections; update `AGENTS.md` rows with `See change: collapse-model-proxy-onto-modelruntime`; verify `openspec validate collapse-model-proxy-onto-modelruntime`

## 5. Scenario tests (from test-plan.md)

- [ ] 5.1 L1 test: single runtime — see `packages/server/src/__tests__/provider-auth-registry.test.ts`; test agent dir · construct all surfaces · one `ModelRuntime.create` (test-plan #E1)
- [ ] 5.2 L1 test: catalogue and login flows agree — see `packages/server/src/__tests__/model-proxy-routes.test.ts`; `anthropic` OAuth credential · providers + models endpoints · listed in both (test-plan #E2)
- [ ] 5.3 L1 test: custom provider everywhere — see `packages/server/src/__tests__/model-proxy-routes.test.ts`; custom provider with 2 models · models / completion / plugin runtime · listed, routable, visible (test-plan #E3)
- [ ] 5.4 L1 test: completion unchanged — see `packages/server/src/__tests__/model-proxy-routes.test.ts`; fake provider · stream with tools + system prompt · request carries tools, system prompt, credential (test-plan #E4)
- [ ] 5.5 L1 test: OAuth-incompatible filter — see `packages/server/src/__tests__/model-proxy-routes.test.ts`; OAuth-only credential + flagged model · `/api/models` · excluded (test-plan #E5)
- [ ] 5.6 L1 test: missing OAuth implementation — see `packages/server/src/model-proxy/__tests__/internal-auth-storage-coordination.test.ts`; provider without OAuth · resolution · missing-capability report, api-key providers routable (test-plan #E6)
- [ ] 5.7 L1 test: no lock across a 5s refresh — see `packages/server/src/model-proxy/__tests__/internal-auth-storage-coordination.test.ts`; 5s fake refresh · `getAuth` · second lock acquires during it (test-plan #X1)
- [ ] 5.8 L1 test: single refresh under concurrency — same exemplar; two parallel requests · `getAuth` · one refresh call (test-plan #X2)
- [ ] 5.9 L1 test: crash during persist — same exemplar with `locked-json-file` harness; kill between write and rename · persist · complete old or new file (test-plan #X3)
- [ ] 5.10 L1 test: corrupt auth.json not overwritten — same exemplar; unparseable file · runtime write · refused, quarantine copy exists (test-plan #X4)
- [ ] 5.11 L1 test: lost race with non-idempotent callback — same exemplar; stored credential changes mid-callback · `store.modify` · lost result not persisted (test-plan #X5)
- [ ] 5.12 L1 test: coordination outcome matrix via the store — re-point the existing `internal-auth-storage-coordination.test.ts` fixtures at `store.modify` · outcomes identical (test-plan #X6)
- [ ] 5.13 L1 test: abort propagates — see `packages/server/src/__tests__/model-proxy-routes.test.ts`; mid-stream abort · completion · upstream aborted (test-plan #X7)
- [ ] 5.14 Manual: real subscription near-expiry refresh through the proxy while pi runs (test-plan: manual-only, #X8)
