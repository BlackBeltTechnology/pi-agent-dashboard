## Why

The server runs **two** pi model runtimes. `provider-auth-registry.ts` creates a real `ModelRuntime` but hands it an empty read-only credential store, only to list OAuth login flows. Every other model path uses a parallel stack: `piai-compat/` (~900 LOC), which synthesizes a legacy pi-ai surface, keeps its own `model.api` → lazy-module dispatch table and translates OAuth shapes; `InternalRegistry` (306) composes the catalogue; `InternalAuthStorage` (356) resolves keys and refreshes OAuth. pi 0.99's `ModelRuntime` does all of that natively (catalogue, availability, `getAuth`, OAuth refresh, `streamSimple`, provider registration) and accepts an **injectable `CredentialStore`**. The dashboard can therefore keep its hardened `auth.json` discipline and delete the re-implementation. Each pi bump has so far required re-verifying this parallel stack against pi internals (see `adopt-piai-factory-api-registry`).

Depends on `update-pi-core-1-0-adopt-apis` (single pi-ai generation, 1.0.0 floor).

## What Changes

- Add a `DashboardCredentialStore` implementing pi-ai's `CredentialStore` over the existing `provider-auth-storage.ts` / `locked-json-file.ts`. It keeps atomic write, corrupt-file quarantine and no-clobber, runs the network refresh outside the file lock with a compare-and-swap persist, serializes `modify`/`delete` per provider in-process, never creates `auth.json`, and recovers a failed refresh from a concurrently stored credential.
- Create **one** server `ModelRuntime` with that store (`allowModelNetwork: false`, `refreshOnCreate: false`, `modelsPath: null` — built-in catalogue only, no credential write at boot). It serves the model proxy, `/api/models`, the plugin model runtime and the provider-auth OAuth flow listing.
- `InternalRegistry` and `InternalAuthStorage` stay as thin facades with their public methods unchanged (`find`, `getAvailable`, `firstAvailable`, `getApiKeyAndHeaders`, `getAll`, `getAllAnnotated`, …), backed by the runtime. The dashboard keeps composing the catalogue (`models.json` reader + `providers.json` discovery merge) and keeps listing auth.json-based (credential-kind filter + `oauth-compat.ts`), so ambient env keys do not change what is listed. The facade single-flights auth resolution per provider (refresh once, also on failure) and reports a missing OAuth capability by name.
- Project the merged custom providers onto the runtime (`unregisterProvider` + `registerProvider`, unregister on removal; a provider whose key does not resolve is skipped before registration) instead of synthesizing api_key credentials in `registry-singleton.ts`.
- The proxy resolves auth through the facade, then streams through `runtime.streamSimple(model, context)` with no `apiKey` override (per-model custom headers still passed): pi normalizes the transcript and applies the provider's own auth path. The plugin `streamSimple` seam is re-sourced from the same runtime.
- **Remove:** `packages/shared/src/piai-compat/` (whole seam), the catalogue-composition and refresh/coordination bodies of `InternalRegistry` and `InternalAuthStorage`, and the `EMPTY_READONLY_STORE` runtime in `provider-auth-registry.ts`.
- **Keep:** `oauth-compat.ts` (`OAUTH_INCOMPATIBLE` policy filter), auth-gate, concurrency caps, recursion guard, request log, API-key store, custom-provider discovery (feeds `registerProvider`).
- No change to the proxy's HTTP contract (`/v1/chat/completions`, `/v1/messages`, `/api/models`).

## Capabilities

### New Capabilities
_None._

### Modified Capabilities
- `model-proxy-credential-routing`: a single server model runtime; credential writes through the runtime keep the dashboard's auth.json guarantees; the relocation-survival requirement becomes "OAuth comes from the runtime's provider definitions". The coordination requirement keeps its text; its "refresh buffer" is now pi's 5-minute window (design Risks).
- `model-proxy`: "identical across runtime generations" becomes "identical across the runtime swap".
- `piai-module-compat`: retired. Its requirements are removed; the seam no longer exists.

## Impact

- **Code:** `packages/server/src/model-proxy/{registry-singleton,internal-registry,internal-auth-storage,streamer}.ts`, `packages/server/src/auth/{provider-auth-registry,provider-auth-storage}.ts`, new `packages/server/src/auth/dashboard-credential-store.ts`, `packages/shared/src/piai-compat/` (deleted), `packages/shared/src/test-support/piai-factory-fixture.ts`, `dashboard-plugin-runtime` `PluginModelRuntime.getModelRegistry()` + `streamSimple` (same shapes, new backing; `server.ts` plugin wiring).
- **Consumers to verify (shape unchanged):** `system-one-plugin/src/server/llm-caller.ts`, `grammar-plugin/src/server/backends/llm.ts`, `quota-plugin/src/server/index.ts`, `server/src/models-introspection-routes.ts`, `server/src/model-proxy-diagnostics-routes.ts`.
- **Specs kept valid without deltas** (facades preserve the named symbols): `custom-provider-model-registry`, `custom-provider-metadata-discovery`, `agent-model-introspection`, `provider-quota-surfacing`.
- **Tests:** piai-compat suites removed; the `model-proxy-credential-routing` coordination scenarios re-pointed at the store adapter (they are the acceptance suite); proxy end-to-end tests unchanged and must stay green.
- **Docs:** `docs/architecture.md` model-proxy and pi-ai window sections (DocScribe), `packages/server/src/model-proxy/AGENTS.md`, `packages/shared/src/AGENTS.md`.
- **Risk:** pi's `ModelRuntime` calls `store.modify()` expecting pi's lock-held semantics. The adapter changes that to "network outside the file lock, CAS on persist". pi's refresh callback re-checks `current`; the server never calls `runtime.login()`, so every server-issued `modify` is a refresh. A callback that ignores `current` still never persists a lost-race result. Pinned by tests; pi `.modify(` call sites re-audited on each bump.
- **Behaviour change:** one `ModelRuntime.create` failure now degrades the model proxy and the provider-auth flow listing together (previously independent).
- **Behaviour change:** OAuth refresh now follows pi's window (refresh at 5 min remaining, 15 s abort) instead of the dashboard's 30 s / 30 s.
- **Rollback:** revert the change; `auth.json` format is unchanged, so no data migration.

## Discipline Skills

`doubt-driven-review` (credential-store semantics swap on a shared auth.json) · `security-hardening` (credential routing, no secrets in errors/logs) · `code-simplification` (seam removal) · `nodejs-expert` checkpoint (≥3 server modules, async refresh coordination) · `review-code`.
