## Context

- Session-side custom-provider discovery: `registerEntry` (`packages/extension/src/provider-register.ts:821`) calls `discoverModels` (`:543`, 10 s `AbortSignal.timeout` at `:555`) and `loadNativeModels`. Only callers: `activate()` startup (`:1091`) and `reloadProvidersNow` (`:921`) for added/changed names.
- Change detection: `entriesEqual` (`provider-register.ts:461`) compares `baseUrl`/`apiKey`/`api` only. Unchanged entry → no re-register → no `/models` fetch.
- `credentials_updated` handler (`packages/extension/src/bridge-handlers/dispatch.ts:106`) → `reloadProviders(pi)` → `refreshAfterCredentialsReload(registry, diff)` (`packages/extension/src/model-refresh.ts:106`, scoped `refresh({providers: touched})`) → pushes `models_list` + `providers_list`. Runs on the serialized inbound pump (`credentials_updated` is not in `IMMEDIATE_TYPES`, `packages/extension/src/connection.ts:363`).
- `CredentialsUpdatedMessage` = `{ type: "credentials_updated" }` (`packages/shared/src/protocol.ts:1327`).
- Server: `refreshModelRegistry()` (`packages/server/src/model-proxy/registry-singleton.ts:118`) → `InternalRegistry.refresh()` → `discover()` re-lists all custom providers (`internal-registry.ts:188`). Health: `probeAndCacheProvider` (`packages/server/src/routes/provider-routes.ts:41`), probe timeout 8 s (`packages/server/src/package/provider-probe.ts:22`).
- Single-provider routes live in `provider-routes.ts` (PATCH `:419`, DELETE `:507`); tier rows in `packages/shared/src/route-tiers.ts`; `/api/providers/:name` denylisted in `packages/mcp-server-plugin/src/server/tools.denylist.ts:18`.
- UI row: `CustomEndpointRow` (`packages/client/src/components/settings/ProviderAuthSection.tsx:1075`); funnel `handleChanged` (`:352`).

## Goals / Non-Goals

**Goals:** user-triggered re-fetch of one custom provider's model list reaching the server catalogue, the health pill, and every live session's selector — no restart, no config edit.

**Non-Goals:** automatic/background polling; selector-open network fetch (D3 of `refresh-models-on-provider-change` stands); built-in / OAuth provider catalogues; bulk "refresh all".

## Decisions

- **D1 Scoped broadcast field, not a new message type.** Extend `CredentialsUpdatedMessage` with optional `refreshProviders?: string[]`. Reuses the existing bridge path (reload → scoped refresh → push `models_list`/`providers_list`). Older bridges ignore unknown fields → degrade to today's behaviour. Alternative (new `refresh_provider_models` message) duplicates the push logic.
- **D2 Force = treat as changed.** `reloadProviders(pi, { force?: string[] })`; in `reloadProvidersNow`, a forced name present in both `lastRegistered` and `current` takes the existing "changed" branch (unregister, delete snapshot, `changed.push`). Re-register loop and `refreshAfterCredentialsReload` then work unchanged — this is the same path an edited `baseUrl` takes today (spec `custom-provider-model-registry` › "reach the session model list without restart"); `pi.registerProvider` (`provider-register.ts:882`) replaces the provider's model set, the scoped refresh recomputes availability. Forced names not in `current` ignored. Goes through `reloadChain` → serialized with other re-syncs (a forced reload queued behind an in-flight one sees its final snapshot). Register failure → existing `catch` logs + drops the name from `added` (provider absent until next re-sync — same as today's changed-path failure).
- **D2a Side effects.** `onProvidersChanged` (`provider-register.ts:890`) fires once per re-register → one extra `providers_list` push, same as an edit. `enrichmentSource` (`:360`) keeps stale `${name}/${id}` keys for removed ids; harmless — read only for ids present in the registry (`:438`); overwritten for re-listed ids (`:878`). No cleanup added (matches changed path).
- **D3 Server endpoint awaits the probe.** `POST /api/providers/:name/refresh` awaits `probeAndCacheProvider` (≤ 8 s) and returns `{ success, health }` — explicit user action wants the fresh count; unlike PATCH it is not on the edit path, so the p95 < 300 ms rule does not apply. `refreshModelRegistry()` runs detached (`.catch(() => {})`, as PATCH does) — it re-discovers every provider and must not gate the response.
- **D4 Broadcast before probe.** Sessions start re-fetching in parallel with the server probe.
- **D5 Tier `operate`, MCP-denylisted.** Matches PATCH/DELETE; the existing `/api/providers/:name` denylist entry is exact-path, so add an explicit `/api/providers/:name/refresh` row (reason: UI-only refresh trigger).
- **D6 Client.** `refreshProviderModels(name)` in `providers-api.ts` → `{ ok: true, health } | { ok: false, error }`. Row holds `refreshing`; while true `derivePillView` gets `testing: true` (spinner pill, `ProviderHealthPill.tsx:40`). Response health → existing `live` state (`live` beats `pending`/cached, `ProviderHealthPill.tsx:41`). On success also call parent `onRefreshed` → `handleChanged` funnel (`ProviderAuthSection.tsx:352`: catalogue refetch + `PROVIDER_AUTH_EVENT`). No reconcile timer scheduled (health already in hand).
- **D6a Row state rules.** Button renders only outside edit mode (beside Edit/Remove). Disabled while `refreshing` or `removePending` (double-click → one request). Entering edit keeps `live` (existing behaviour clears it on field change). Unmount mid-flight → result ignored (mounted ref). Failure → inline `error`, `live` untouched, button re-enabled.
- **D7a Cold registry.** `refreshModelRegistry()` no-ops when the singleton is unset (`registry-singleton.ts:119`). A cold registry builds by running `discover()` on first `getModelRegistry()` — fresh by construction — so no-op is correct; the route still calls `refreshModelRegistry()` only (mirrors `model-proxy-refresh-routes.ts`, which calls `getModelRegistry()` first; not needed here because cold = nothing stale).
- **D7 Server rediscovery is global.** The session side is scoped to the named provider; `refreshModelRegistry()` re-discovers every custom provider (`internal-registry.ts:188` → `discover()`). Contract wording says "refresh the server model registry", not "one provider". Acceptable: detached, same as PATCH.
- **D8 No key leakage.** Response = `{ success, health }` where health is `toHealth(probeResult)` (`provider-routes.ts:33`) — status / error / modelCount only, same shape `GET /api/providers` already returns. Log lines carry provider names + counts only.
- **D9 Identity/road gating.** `classifyHttpRoad` is segment-based (`packages/server/src/identity/http-road-classification.ts:68` `providers` → `providers`), so the new route classifies with no table edit; add an assertion to `http-road-classification.test.ts`.

## Risks / Trade-offs

- [Forced re-register runs a ≤ 10 s `/models` fetch on the serialized pump] → only on explicit click; one provider; same cost as an edited provider today.
- [Unregister → re-register window: a session briefly lacks the provider's models] → same window as an edit today; push happens after re-register.
- [Server re-discovers all providers, not just one] → existing `refreshModelRegistry` contract; detached from the response.
- [Older bridges ignore `refreshProviders`] → their list stays stale until restart (today's behaviour); acceptable.
