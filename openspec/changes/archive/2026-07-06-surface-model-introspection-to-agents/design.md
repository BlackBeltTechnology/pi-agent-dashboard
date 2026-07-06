# Design — surface-model-introspection-to-agents

## Verified ground truth (live probe, 2026-07-06)

| Surface | Result | Meaning |
|---|---|---|
| `GET /v1/models` (no key) | `401 AUTH_REQUIRED` | catalogue gated behind `pi-proxy-...` Bearer |
| `GET /v1/models` (minted key) | `200`, 38 models, `x-pi` metadata | catalogue is correct + rich, just wrong door for in-session agents |
| `GET /api/provider-auth/status` (no key) | `200`, providers only | open, but no model catalogue |
| `~/.pi/agent/providers.json` | `{roles, rolePresets, activePreset}` | **no models** — the agent's parse target was empty by construction |

Providers in the reachability-filtered set: `anthropic`(15), `opencode-go`(12), `openai-codex`(6), `zai`(5). Non-anthropic reviewer pool = `[openai-codex, opencode-go, zai]`.

## Data source already exists

`packages/server/src/model-proxy/internal-registry.ts` (`InternalRegistry`):
- `getAvailable()` → authed/reachable models only (via `canRouteModel`).
- `getAllAnnotated()` → all models + `excludedReason` (`no-credential` | `oauth-incompatible`). Added by archived change `2026-07-02-filter-oauth-incompatible-models`.

The gated `/v1/models` route (`routes/model-proxy-routes.ts`) already calls `registry.getAvailable()` and maps to the OpenAI shape. The new `GET /api/models` reuses the same `getRegistry()` dependency — no new composition path.

## Open questions to settle in implementation

1. **Auth posture.** Open like `/api/provider-auth/status` (subject only to the dashboard's own auth gate) vs require a lightweight scope. Leaning open: it exposes no secrets, and the whole point is frictionless in-session access. `doubt-driven-review` checkpoint.
2. **Response shape.** Native `{ id, provider, reasoning, input, contextWindow, maxTokens, cost }` rows vs reuse the OpenAI `{ object, data:[{id, owned_by, "x-pi":{...}}] }` envelope. Leaning native for the agent-facing route (cleaner to filter), keeping OpenAI shape exclusive to `/v1/models`. Decide before spec locks.
3. **`annotated` default.** `?annotated=1` opt-in (default = reachable-only) vs always annotate. Leaning opt-in to keep the common case small.
4. **Cross-model-review policy.** Out of scope here; if the reviewer-picking loop recurs, a follow-up `resolve_reviewer` skill sits on top of this endpoint (`GET /api/models` → filter `provider != anthropic` → probe). Named so it is not forgotten, not built here.

## Why REST + skill, not a bridge tool / RPC

- pi exposes no `listModels` RPC/SDK method (grep of `sdk.md`/`rpc.md` = nothing); only the `pi --list-models` CLI text and `ctx.modelRegistry` in-extension.
- The dashboard bridge already composes the registry (`provider-register.ts::buildProviderInfo`) and the server already owns `InternalRegistry`. A REST route is the lowest-friction agent-reachable surface and needs no new tool-registration plumbing.
- A skill command turns the endpoint into discoverable agent behavior; the endpoint alone would remain unknown to agents (the exact failure this change fixes).
