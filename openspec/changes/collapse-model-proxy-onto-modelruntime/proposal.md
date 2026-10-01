## Why

The server runs **two** pi model runtimes. `provider-auth-registry.ts` creates a real `ModelRuntime` but hands it an empty read-only credential store, only to list OAuth login flows. Every other model path uses a parallel stack: `piai-compat/` (~900 LOC), which synthesizes a legacy pi-ai surface, keeps its own `model.api` → lazy-module dispatch table and translates OAuth shapes; `InternalRegistry` (306) composes the catalogue; `InternalAuthStorage` (356) resolves keys and refreshes OAuth. pi 0.99's `ModelRuntime` does all of that natively (catalogue, availability, `getAuth`, OAuth refresh, `streamSimple`, provider registration) and accepts an **injectable `CredentialStore`**. The dashboard can therefore keep its hardened `auth.json` discipline and delete the re-implementation. Each pi bump has so far required re-verifying this parallel stack against pi internals (see `adopt-piai-factory-api-registry`).

Depends on `update-pi-core-0-99-adopt-apis` (single pi-ai generation, 0.99.1 floor).

## What Changes

- Add a `DashboardCredentialStore` implementing pi-ai's `CredentialStore` over the existing `provider-auth-storage.ts` / `locked-json-file.ts`. It keeps atomic write, corrupt-file quarantine and no-clobber, runs the network refresh outside the lock with a compare-and-swap persist, and dedupes refreshes per provider in-process.
- Create **one** server `ModelRuntime` with that store (`allowModelNetwork` / `refreshOnCreate` chosen to match today's offline-first catalogue). It serves the model proxy, `/api/models`, the plugin model runtime and the provider-auth OAuth flow listing.
- Register `providers.json` custom providers on the runtime (`registerProvider`) instead of synthesizing api_key credentials in `registry-singleton.ts`.
- The proxy streams through `runtime.streamSimple(model, context)`: pi normalizes the transcript and resolves auth.
- **Remove:** `packages/shared/src/piai-compat/` (whole seam), the registry/refresh parts of `InternalRegistry` and `InternalAuthStorage`, and the `EMPTY_READONLY_STORE` runtime in `provider-auth-registry.ts`.
- **Keep:** `oauth-compat.ts` (`OAUTH_INCOMPATIBLE` policy filter), auth-gate, concurrency caps, recursion guard, request log, API-key store, custom-provider discovery (feeds `registerProvider`).
- No change to the proxy's HTTP contract (`/v1/chat/completions`, `/v1/messages`, `/api/models`).

## Capabilities

### New Capabilities
_None._

### Modified Capabilities
- `model-proxy-credential-routing`: a single server model runtime; credential writes through the runtime keep the dashboard's auth.json guarantees; the relocation-survival requirement becomes "OAuth comes from the runtime's provider definitions".
- `model-proxy`: "identical across runtime generations" becomes "identical across the runtime swap".
- `piai-module-compat`: retired. Its requirements are removed; the seam no longer exists.

## Impact

- **Code:** `packages/server/src/model-proxy/{registry-singleton,internal-registry,internal-auth-storage,streamer}.ts`, `packages/server/src/auth/{provider-auth-registry,provider-auth-storage}.ts`, new `packages/server/src/auth/dashboard-credential-store.ts`, `packages/shared/src/piai-compat/` (deleted), `packages/shared/src/test-support/piai-factory-fixture.ts`, `dashboard-plugin-runtime` `PluginModelRuntime.getModelRegistry()` (same shape, new backing), `system-one-plugin` `llm-caller.ts` (consumer; verify).
- **Tests:** piai-compat suites removed; the `model-proxy-credential-routing` coordination scenarios re-pointed at the store adapter (they are the acceptance suite); proxy end-to-end tests unchanged and must stay green.
- **Docs:** `docs/architecture.md` model-proxy and pi-ai window sections (DocScribe), `packages/server/src/model-proxy/AGENTS.md`, `packages/shared/src/AGENTS.md`.
- **Risk:** pi's `ModelRuntime` calls `store.modify()` expecting pi's lock-held semantics. The adapter changes that to "network outside the lock". This is safe only if every `modify` callback is idempotent-on-stale-input (pi-ai re-checks `expiresSoon(current)` inside its callback). Pinned by tests.
- **Rollback:** revert the change; `auth.json` format is unchanged, so no data migration.

## Discipline Skills

`doubt-driven-review` (credential-store semantics swap on a shared auth.json) · `security-hardening` (credential routing, no secrets in errors/logs) · `code-simplification` (seam removal) · `nodejs-expert` checkpoint (≥3 server modules, async refresh coordination) · `review-code`.
