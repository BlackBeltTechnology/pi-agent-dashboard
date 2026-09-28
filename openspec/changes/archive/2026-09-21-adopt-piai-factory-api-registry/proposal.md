## Why

The server-resident model registry is pinned to `@earendil-works/pi-ai@^0.75.5` because `InternalRegistry` consumes pi-ai's **removed global-registry API** (`registerBuiltInApiProviders`, `getModels`, `getProviders`, `getModel`, `streamSimple`). Every pi-ai ≥ 0.85 exposes a **factory API** instead, so the pin cannot move — and the 0.75.5 model table is now materially older than the pi that actually runs sessions (pi 0.86.1).

Observable consequence: `GET /api/models` tops out at `anthropic/claude-opus-4-7` / `zai/glm-5.1` and omits `claude-opus-5`, `glm-5.3`, `deepseek/deepseek-flash`. The Settings → Default Model picker (whose options come from that catalogue) therefore cannot show models the user's sessions offer, and its ★Favs filter renders "No models match" because every server-persisted favorite was starred from a session running the newer pi. A naive pin bump was attempted and reverted: it takes the **entire model proxy** down (`503 MODEL_PROXY_RUNTIME_MISSING`, `/api/health.proxy: degraded`).

Adversarial review established that the break is **not** confined to the seven global members. Three independent boundaries move together, and any one of them left unhandled ships a silent failure:

1. **Module shape** — the global registry API became a factory API.
2. **Transcript normalization** — factory-path api implementations read only `context.messages`; `systemPrompt` and `tools` are folded in by `normalizeContext`, which only `Models.stream*` calls. Dispatching below that layer silently drops the system prompt and every tool definition.
3. **OAuth relocation** — `dist/oauth.js` in 0.86.1 is a type-only stub (`export {};`). `InternalAuthStorage` holds it as a truthy `{}` and would throw `TypeError` on every OAuth token refresh. The real implementations moved to `dist/auth/oauth/*`, a path **not present in the package's `exports` map**.

## What Changes

- **New shared seam** `packages/shared/src/piai-compat/` — an **async** `adaptPiAi(module, resolvedPath)` that normalizes either pi-ai generation into the existing (synchronous) `PiAiModule` surface, plus an OAuth capability facade. All subpath loading happens during construction, so consumers keep a sync surface. It lives in `shared` (not `server`) because `packages/extension` depends only on `shared` + `bus-client`.
- `packages/server/src/model-proxy/registry-singleton.ts` routes its resolved pi-ai module **and** its OAuth subpath through the seam before constructing `InternalRegistry` / `InternalAuthStorage`, and caches the **adapted** surface (caching the raw module would leave `getStreamSimpleFn()` undefined on a factory runtime).
- Factory-path streaming calls the resolved runtime's own `normalizeContext` and then dispatches **api-first** (`model.api` → lazy api implementation) — and **api-only** when the model names an api, since falling back to the owning built-in provider for an *unmapped* api silently streams through the wrong protocol (`createProvider`'s single-api form ignores `model.api`). The provider is consulted only when the model carries no `api`. It deliberately does **not** go through `Models.streamSimple`, which throws for OAuth-only providers such as `openai-codex` when handed a caller-supplied key. Nothing is registered into the built-in collection.
- The factory branch projects `getProviders()` — which returns `Provider` **objects** — to id strings; the legacy `PiAiModule` contract is `() => string[]`, and passing objects back into `getModels()` yields **zero** models with no error.
- OAuth refresh resolves through a **per-provider** capability facade over the relocated `dist/auth/oauth/*` loaders; when a provider's OAuth implementation cannot be located the registry degrades **explicitly** (api-key models keep working, that provider reports a diagnosable reason) instead of throwing `TypeError`.
- `packages/extension/src/bridge.ts` streams through pi's own `ctx.modelRegistry`, restoring auto-session-naming under pi ≥ 0.85 where `mod.streamSimple` is `undefined` — removing a compat surface rather than adding one.
- Root `package.json` devDependency `@earendil-works/pi-ai` `^0.75.5` → `^0.86.1`, and the pi-ai `peerDependencies` range states the supported window. **`piCompatibility` is untouched** — it is a `@earendil-works/pi-coding-agent` range, a different artifact from the pi-ai pin.
- `packages/server/src/__tests__/pi-ai-shape.test.ts` — the precondition test asserting the seven global members and six OAuth symbols — is rewritten to assert the **seam's** contract across both generations.
- `docs/architecture.md` lockstep statement (`minimum == recommended`, "no conditional code paths in the bridge") is amended: the dashboard now supports a two-generation window through one declared seam.
- **BREAKING (internal only):** `PiAiModule` is no longer the raw pi-ai module; consumers must obtain it from the seam. No public HTTP/API contract changes.

## Capabilities

### New Capabilities
- `piai-module-compat`: the contract that the dashboard runs against either pi-ai module generation — member-by-member mapping, transcript normalization, credential ownership, OAuth capability degradation, and the failure mode when neither shape is recognized.

### Modified Capabilities
- `custom-provider-model-registry`: the built-in model set the server exposes SHALL come from the pi-ai version actually installed, not a pinned floor; registry construction SHALL succeed against both module generations, and the mechanism used to source built-ins SHALL NOT perturb the registry's composition or deduplication.
- `model-proxy`: upstream streaming SHALL preserve the system prompt and tool definitions across both generations while credentials stay caller-resolved.
- `model-proxy-credential-routing`: OAuth credential refresh SHALL survive the relocation of pi-ai's OAuth entry point, and SHALL degrade diagnosably rather than throwing when no implementation is reachable.

## Impact

- **Code**: `packages/shared/src/piai-compat/**` (new), `packages/server/src/model-proxy/{registry-singleton.ts, internal-auth-storage.ts}`, `packages/server/src/__tests__/pi-ai-shape.test.ts`, `packages/extension/src/bridge.ts`, root `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `docs/architecture.md`.
- **Unchanged**: `InternalRegistry`'s composition/precedence/dedup logic, every model-proxy route handler, the `/v1/*` wire contract.
- **APIs**: `GET /api/models` (+`?annotated=1`) gain the newer models — additive; row shape unchanged.
- **Dependencies**: `@earendil-works/pi-ai` 0.75.5 → 0.86.1. New reliance on two pi-ai subpaths outside its `exports` map (`dist/auth/oauth/*`) — probed at runtime, never assumed.
- **Known pre-existing defect surfaced, deliberately NOT fixed here**: the live proxy seam (`server.ts:2018`) passes `system:` while `normalizeContext` and legacy 0.75.5 both read `systemPrompt:` — so proxy system prompts are already dropped today. Fixing it is a behavior change that belongs in its own change; this one must not silently alter it.
- **Rollback**: reverting the pin + `pnpm install` restores the 0.75.5 **runtime**. Restoring pre-change **code** additionally requires reverting the seam commit, because the seam also replaces the legacy resolution path (shape detection, OAuth probe). Both steps are in the design's migration plan.

## Discipline Skills

- `doubt-driven-review` — already run (cycle 1 inverted D3 and surfaced the OAuth break); cycle 2 gates the corrected artifacts.
- `security-hardening` — the streaming and OAuth paths carry provider credentials; verify none reaches a log, an error message, or an unintended store.
- `systematic-debugging` — red tests on the factory branch must be root-caused against the real 0.86.1 module, never guessed.
- `review-code` — non-trivial, credential-adjacent diff crossing three packages.
- `observability-instrumentation` — the OAuth-degradation path must be visible in `/api/health` rather than failing silently.
