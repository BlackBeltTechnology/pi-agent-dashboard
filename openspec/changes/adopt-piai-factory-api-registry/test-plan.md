# Test Plan — adopt-piai-factory-api-registry

Stage: design   Generated: 2026-09-20

Clarifications C1–C4 were resolved via `ask_user` before this catalog was written (HARD gate) — no `[NEEDS CLARIFICATION]` markers remain.

**C1 resolution note (design-affecting).** The requested "lazy-build + O(1) init" cannot be satisfied *inside* the adapted surface: `getProviders()`/`getModels()` are consumed synchronously by `InternalRegistry.getAllModels()`, so the collection must be materialized before the surface is handed over. It IS satisfied one level up — `getModelRegistry()` is already lazy, so the 41-module import lands on first registry use, never at server boot. P1 tests exactly that.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | compat: legacy passes through | decision-table | L1 | automated | fake module with all 7 legacy members | `adaptPiAi(mod, path)` | returns the input object identity; no subpath import attempted |
| E2 | compat: factory is adapted | decision-table | L1 | automated | real ≥0.85 module + resolved path | `adaptPiAi(mod, path)` | returns a surface whose `getProviders()` is non-empty |
| E3 | compat: partial module rejected | decision-table | L1 | automated | fake with `getModels` but no `streamSimple` | `adaptPiAi(...)` | rejects; message names `streamSimple` as missing; NOT classified legacy |
| E4 | compat: unrecognized rejected | decision-table | L1 | automated | `{}` | `adaptPiAi(...)` | rejects with a diagnosable reason; neither branch taken |
| E5 | registry: built-ins from installed runtime | EP (type projection) | L1 | automated | real ≥0.85 module | adapt, then `getProviders()` + sum `getModels(id)` | `getProviders()` returns **strings** (not `Provider` objects) and the summed model count is > 1000 (measured 1443) |
| E6 | registry: composition not perturbed | state/decision | L1 | automated | custom model `foo/bar` authored under built-in provider name `anthropic`, with `api` ≠ anthropic's | stream dispatch | dispatched via its own `model.api`, NOT the built-in provider's single api |
| E7 | compat: undispatchable reported | BVA (unmapped key) | L1 | automated | model with `api: "nope-api"`, unknown provider, caller `apiKey: "SECRET"` | stream dispatch | throws naming the api and the model; error string contains no `SECRET` |
| E8 | compat: table drift guard | decision-table | L1 | automated | the resolved runtime's shipped `dist/api/*.lazy.js` set (11 files) | diff against the D4 table | every **text** factory has an entry; `openrouter-images.lazy.js` is excluded without false-failing |
| E9 | compat: derived subpath validated | BVA (path shapes) | L1 | automated | resolved path not ending in the expected entry file | subpath derivation | errors with the resolved path in the message; does NOT silently no-op |
| E10 | registry: built-in wins dedup | decision-table | L1 | automated | custom entry declaring an existing built-in `provider/id` | catalogue composition | the built-in model is retained, exactly as today |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | C1: init stays O(1) | threshold | L2 | automated | cold server start, no model request issued | `/api/health` shows the model registry **uninitialized** (no pi-ai import performed) | first 10s after boot |
| P2 | C1: first-use cost is bounded | tail-latency | L1 | automated | adapt the real ≥0.85 module 5× cold | p95 of `adaptPiAi(...)` duration < 1500ms | 5 runs |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | original symptom: favorites reachable | state-convergence | L3 | automated | server-persisted favorites naming models only the ≥0.85 catalogue has | open Settings → Sessions → Default model, toggle ★Favs | list converges to those favorites; never the "No models match" empty state |
| F2 | picker tracks installed runtime | state-convergence | L3 | automated | ≥0.85 runtime resolved | open the Default Model picker | options include a model absent from 0.75.5 (e.g. `claude-opus-5`) |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | compat: unrecognized → 503 | fault-injection | L1 | automated | registry resolution rejects (unrecognized module) | `GET /api/models` | `503` with code `MODEL_PROXY_RUNTIME_MISSING`; `/api/health` reports proxy degraded **with the reason** |
| X2 | oauth: type-only stub counts as unavailable | fault-injection | L1 | automated | oauth entry point loads but exports `{}` | build the facade, then refresh an OAuth provider | facade reports that provider unavailable; **no `TypeError`** raised |
| X3 | oauth: relocated loaders work | state-transition | L1 | automated | runtime exposing only the relocated async loaders; stored `{access, refresh, expires}` credential | token refresh | refresh succeeds; storage receives `{accessToken, refreshToken, expiresAt}` |
| X4 | oauth: degradation is partial | decision-table | L1 | automated | no reachable OAuth implementation | route an api-key model and an OAuth model | api-key model routes normally; OAuth model fails diagnosably; `proxy.oauthProviders` reports per-provider booleans (C2) |
| X5 | streaming: OAuth-only provider works | fault-injection | L1 | automated | `openai-codex` model (no `provider.auth.apiKey`), caller `apiKey` supplied, empty credential store | stream dispatch | dispatches to the api implementation; does NOT fail with `Provider is not configured` |
| X6 | streaming: transcript preserved | state-transition | L1 | automated | context with `systemPrompt` + 1 tool definition | factory-branch stream | provider receives a normalized transcript whose leading message carries the prompt and `toolsAdded` length 1; `getAuth` never invoked |
| X7 | streaming: legacy branch not normalized | decision-table | L1 | automated | same context, legacy module | legacy-branch stream | context passed through **unnormalized** (no double-handled prompt) |
| X8 | streaming: caller credentials win | fault-injection | L1 | automated | caller `apiKey` + headers, runtime credential store populated with a different key | stream dispatch | the caller's key and headers are the ones sent upstream |
| X9 | proxy: abort propagates | fault-injection (abort) | L1 | automated | in-flight stream with an `AbortSignal` | abort mid-stream | the `signal` reaches the provider options; upstream request terminates |
| X10 | compat: stream stays async-iterable | EP | L1 | automated | any factory-branch stream | `for await` over the result | iterates runtime stream events; existing consumers unchanged |
| X11 | proxy: existing system-prompt handling unaltered | state-transition | L1 | automated | proxy route supplying its prompt under today's `system:` key | completion through the route | whether the prompt reaches the provider is **identical** to pre-change behavior (deferral guard, design Non-Goals) |
| X12 | catalogue: credential-independent assertion | EP | L2 | automated | ≥0.85 runtime, no provider credentials present | `GET /api/models?annotated=1` (C3) | `data` contains `anthropic/claude-opus-5`, `zai/glm-5.3`, `deepseek/deepseek-flash` |
| X13 | compat: Windows path derivation | state-transition | L2 | automated | Windows runner, native-separator resolved path (C4) | registry init on the Windows VM | subpath derivation succeeds; model registry reaches `ready` |
| X14 | compat: caller context keys not reinterpreted | decision-table | L1 | automated | context whose prompt sits under a key the runtime's normalization does not read | stream dispatch | the seam does NOT remap the key; behavior unchanged from pre-change |

### Manual-only

| id | requirement | technique | level | disposition | surface | trigger | expected observable |
|----|-------------|-----------|-------|-------------|---------|---------|---------------------|
| M1 | credential-routing: live OAuth refresh | live-credential | — | manual-only | a real OAuth-credentialed provider | expire and refresh a real token | [judgment: requires real provider credentials; no CI-automatable signal] |
| M2 | proxy: live completion with prompt + tool | live-credential | — | manual-only | `/v1/chat/completions` against a real provider | stream a completion carrying a system prompt and a tool | [judgment: requires live provider credentials and upstream inspection] |

---

## Coverage summary

- Requirements covered: 8/8 (compat ×4, registry ×2, proxy ×1, credential-routing ×1)
- Scenarios by class: edge 10 · perf 2 · frontend 2 · error 14 · manual 2
- Scenarios by level: L1 21 · L2 3 · L3 2 · — 2
- Scenarios by disposition: automated 28 · manual-only 2

## New infra needed

None. Every level has an existing harness:
- **L1** — `packages/server/src/model-proxy/__tests__/internal-registry.test.ts`, `internal-auth-storage-refresh.test.ts`, `streamer.test.ts`; new shared-seam tests go in `packages/shared/src/piai-compat/__tests__/`.
- **L2** — `qa/tests/02-server-start.sh` / `.ps1` (Windows runner already exists for X13).
- **L3** — `tests/e2e/model-favorites-cross-surface.spec.ts` and `tests/e2e/settings-default-model-catalogue.spec.ts` cover exactly these surfaces.
