## 0. Gate

- [x] 0.1 Confirm `update-pi-core-1-0-adopt-apis` has landed; re-verify every design.md Context citation (`ModelRuntime.create` options, `modelsPath: null`, `refreshOnCreate`, `registerProvider` merge / `unregisterProvider`, `CredentialStore` contract, pi `.modify(` call sites, `prepareRequest` header merge) against the installed pi 1.0.0 dist, and the provider-auth flow list against `FLOW_TYPE_HINT`; record deviations in design.md before task 1.2

## 1. Credential store

- [x] 1.1 Extend `provider-auth-storage.ts` / `locked-json-file.ts`: type-agnostic locked read, `AbortSignal` support in the lock-retry loop, `createIfMissing` passthrough on `removeCredential`; verify the existing `provider-auth-storage*.test.ts` suites stay green
- [x] 1.2 Implement `packages/server/src/auth/dashboard-credential-store.ts` (`read`/`list`/`modify`/`delete`) per design D1: per-provider in-process mutex shared by `modify`/`delete`, locked snapshot before `fn`, CAS persist, failed-refresh re-read; make tasks 5.11, 5.12, 5.14–5.17, 5.21, 5.23, 5.25 pass

## 2. Single runtime behind facades

- [x] 2.1 Create one server `ModelRuntime` in `registry-singleton.ts` with the store (`modelsPath: null`, `refreshOnCreate: false`, `allowModelNetwork: false`) and back the `InternalRegistry` facade with it (dashboard catalogue merge + auth.json-based availability kept); verify `/api/models` and `?annotated=1` output unchanged against a recorded fixture
- [x] 2.2 Project merged custom providers onto the runtime (`resolveProbeApiKey` pre-check, `unregisterProvider` + `registerProvider`, unregister on removal); make tasks 5.3, 5.7, 5.8 pass
- [x] 2.3 Back `InternalAuthStorage.getApiKeyAndHeaders` with `runtime.getAuth`, single-flighted per provider (today's `refreshLocks` signal behaviour); add the missing-OAuth-capability check + diagnostics field; delete its refresh/coordination body; make tasks 5.6, 5.13, 5.20, 5.24 pass; verify `quota-plugin` credential resolution unchanged
- [x] 2.4 Switch the proxy streamer to facade auth then `runtime.streamSimple(model, context, { signal, headers })` with no `apiKey` override; map wrapped store errors to the named outcomes (D2); verify the full model-proxy suite (tools, system prompt, abort, mid-stream failure, concurrency) passes
- [x] 2.5 Re-source plugin `streamSimple` (`getStreamSimpleFn` wiring in `server.ts`) from `runtime.streamSimple`; verify `system-one-plugin` `llm-caller.ts`, `grammar-plugin` `backends/llm.ts`, `quota-plugin` `index.ts`, `models-introspection-routes.ts`, `model-proxy-diagnostics-routes.ts` against their existing tests
- [x] 2.6 Inject the runtime into `provider-auth-registry.ts` (no import cycle), delete `EMPTY_READONLY_STORE`, fix the `refreshOnCreate` comment; verify the provider-auth OAuth flow listing is unchanged and task 5.19 passes

## 3. Removal

- [x] 3.1 Delete `packages/shared/src/piai-compat/` and `test-support/piai-factory-fixture.ts`; remove the dead catalogue-loading/refresh code from `internal-registry.ts` / `internal-auth-storage.ts`; verify `rg -n 'piai-compat|adaptPiAi' packages` is empty and `npm test` is green
- [x] 3.2 Decide `provider-catalogue-cache.ts` per D4; delete it if redundant, otherwise record it as follow-up; verify the providers settings page renders unchanged — kept (not redundant: bridge-pushed displayName/envVar/ambient/authLabel), recorded in design.md

## 4. Review and docs

- [x] 4.1 Run the Audit subagent on the diff (credential routing, no secrets in errors/logs); fix its findings
- [x] 4.2 DocScribe: update the `docs/architecture.md` model-proxy and pi-ai window sections; update `AGENTS.md` rows with `See change: collapse-model-proxy-onto-modelruntime`; verify `openspec validate collapse-model-proxy-onto-modelruntime --strict`

## 5. Scenario tests (from test-plan.md)

- [x] 5.1 L1 test: single runtime — see `packages/server/src/__tests__/provider-auth-registry.test.ts`; test agent dir · construct proxy, `/api/models`, plugin runtime, provider-auth listing · exactly one `ModelRuntime.create` with `modelsPath: null`, `refreshOnCreate: false`, `allowModelNetwork: false` (test-plan #E1)
- [x] 5.2 L1 test: catalogue and login flows agree — see `packages/server/src/__tests__/model-proxy-routes.test.ts`; `anthropic` OAuth credential · providers + models endpoints · listed in both with its models (test-plan #E2)
- [x] 5.3 L1 test: custom provider everywhere — see `packages/server/src/model-proxy/__tests__/internal-registry-native-merge.test.ts`; custom provider with 2 models · `/api/models`, proxy completion, plugin `find` + `streamSimple` · listed, routable, visible (test-plan #E3)
- [x] 5.4 L1 test: built-in completion unchanged — see `packages/server/src/model-proxy/__tests__/streamer.test.ts`; fake provider · stream with tools + system prompt · upstream carries tools, system prompt, credential; no `apiKey` override passed (test-plan #E4)
- [x] 5.5 L1 test: OAuth-incompatible filter kept — see `packages/server/src/model-proxy/__tests__/oauth-compat.test.ts`; OAuth-only credential + flagged model · `/api/models` and `?annotated=1` · excluded, reason `oauth-incompatible` (test-plan #E5)
- [x] 5.6 L1 test: missing OAuth implementation — see `packages/server/src/__tests__/model-proxy-diagnostics-routes.test.ts`; OAuth credential, provider without `auth.oauth` · completion + diagnostics · named missing-OAuth error, no TypeError, diagnostics lists provider, api-key providers routable (test-plan #E6)
- [x] 5.7 L1 test: removed custom provider / field disappears — see `packages/server/src/model-proxy/__tests__/registry-singleton-seam.test.ts`; (a) entry removed, (b) `apiKey` removed · providers.json change · (a) absent from runtime and `/api/models`, (b) key unused, `unregisterProvider` before re-register (test-plan #E7)
- [x] 5.8 L1 test: unresolved `$ENV` custom key — see `packages/server/src/model-proxy/__tests__/registry-singleton-seam.test.ts`; `apiKey: "$UNSET_VAR"` · registry build · no throw, not registered, others registered, no secret in log (test-plan #E8)
- [x] 5.9 L1 test: ambient env does not list — see `packages/server/src/model-proxy/__tests__/internal-registry.test.ts`; no `openai` in `auth.json`, `OPENAI_API_KEY` exported · `/api/models` · no `openai/*` (test-plan #E9)
- [x] 5.10 L1 test: custom per-model headers survive — see `packages/server/src/model-proxy/__tests__/streamer.test.ts`; model `headers: { "X-Org": "a" }` · proxy completion · upstream carries `X-Org: a` (test-plan #E10)
- [x] 5.11 L1 test: api_key credential through the store — see `packages/server/src/__tests__/provider-auth-storage.test.ts`; `api_key` credential in `auth.json` · `store.read` + completion · credential returned, upstream uses it not env (test-plan #E11)
- [x] 5.12 L1 test: no lock across a 5s refresh — see `packages/server/src/model-proxy/__tests__/internal-auth-storage-coordination.test.ts`; 5s fake refresh · `getAuth` · second lock acquires during it (test-plan #X1)
- [x] 5.13 L1 test: single refresh under concurrency — see `packages/server/src/model-proxy/__tests__/internal-auth-storage-refresh.test.ts`; two parallel requests, expiring credential · facade auth resolution · one refresh call (test-plan #X2)
- [x] 5.14 L1 test: crash during persist — see `packages/server/src/model-proxy/__tests__/auth-json-contention.test.ts`; kill between temp write and rename · persist · previous or new complete JSON (test-plan #X3)
- [x] 5.15 L1 test: corrupt auth.json not overwritten — see `packages/server/src/__tests__/provider-auth-storage-corrupt.test.ts`; unparseable file · runtime-triggered write · refused, quarantine copy exists (test-plan #X4)
- [x] 5.16 L1 test: lost race with non-idempotent callback — see `packages/server/src/model-proxy/__tests__/internal-auth-storage-coordination.test.ts`; stored credential changes mid-callback · `store.modify` with callback ignoring `current` · lost result not persisted, stored returned or named error (test-plan #X5)
- [x] 5.17 L1 test: coordination outcome matrix via the store — re-point the fixtures in `packages/server/src/model-proxy/__tests__/internal-auth-storage-coordination.test.ts` at `store.modify` driven as pi-ai drives it, incl. both failed-refresh rows · each outcome identical, named errors via `ModelsError.cause` unwrap (test-plan #X6)
- [x] 5.18 L1 test: abort propagates — see `packages/server/src/__tests__/model-proxy-routes.test.ts`; client aborts mid-stream · `/v1/chat/completions` · upstream fetch aborted (test-plan #X7)
- [x] 5.19 L1 test: joint degradation — see `packages/server/src/__tests__/provider-auth-registry.test.ts`; `ModelRuntime.create` rejects · server boot · listing `{ ids: [] }` + `getRegistryError()`, proxy and `/api/models` report same error, no crash (test-plan #X9)
- [x] 5.20 L1 test: failed refresh shared once — see `packages/server/src/model-proxy/__tests__/internal-auth-storage-refresh.test.ts`; two requests, provider rejects refresh · facade auth resolution · one refresh call, both fail with that error (test-plan #X10)
- [x] 5.21 L1 test: delete never creates auth.json — see `packages/server/src/__tests__/provider-auth-storage.test.ts`; no `auth.json` · `store.delete` · still absent (test-plan #X11)
- [x] 5.22 L1 test: no credential write at boot — see `packages/server/src/__tests__/provider-auth-registry.test.ts`; OAuth credential expiring in 1 min · runtime create · no refresh call, `auth.json` byte-identical (test-plan #X12)
- [x] 5.23 L1 test: torn read retried — see `packages/server/src/__tests__/provider-auth-storage-corrupt.test.ts`; truncated JSON on unlocked read, valid on locked re-read · `store.read` · valid credential, no quarantine (test-plan #X13)
- [x] 5.24 L1 test: refresh abort propagates — see `packages/server/src/model-proxy/__tests__/internal-auth-storage-refresh.test.ts`; initiating request aborts mid-refresh · facade auth resolution · refresh signal aborted, nothing written (test-plan #X14)
- [x] 5.25 L1 test: serialized modify/delete — see `packages/server/src/model-proxy/__tests__/internal-auth-storage-coordination.test.ts`; `delete` during a 2s `modify` · both calls · `delete` starts after `modify` settles, no credential left (test-plan #X15)
- [ ] 5.26 Manual: real Anthropic subscription with a near-expiry token refreshes once through the proxy while a pi session runs; `auth.json` stays valid and pi keeps working (test-plan: manual-only, #X8)
