## Why

A custom provider's model list is fetched from its `/models` endpoint only when the provider is registered: at session start, or when its `baseUrl` / `apiKey` / `api` changes. When the endpoint starts returning different models (new model deployed, old one retired) with the same connection details, running sessions and the server catalogue keep the stale list until every pi session restarts. Re-saving the provider unchanged does nothing (the re-sync diff is empty), and selector open is local-only by design (archived change `refresh-models-on-provider-change`, D3 — its risk note says "revisit if users ask"). Users asked.

## What Changes

- New `POST /api/providers/:name/refresh` — re-fetches one custom provider's model list on demand: server catalogue rediscovery + health re-probe (awaited, bounded), plus a scoped `credentials_updated` broadcast telling every session to force re-register that provider.
- `credentials_updated` gains optional `refreshProviders?: string[]`; bridges treat each named provider as changed (unregister + re-register → re-fetch `/models` + re-read native `models.json` entries), then push a fresh `models_list`. Older bridges ignore the field (no-op, same as today).
- Settings → Providers: each custom-endpoint row gets a **Refresh models** button (spinner while in flight); on completion the health pill shows the fresh model count and the settings catalogue refetches.
- Selector open stays local-only — no change to D3.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `custom-provider-crud`: adds the single-provider models-refresh endpoint (tier + MCP binding/denylist) and the per-row Refresh models control.
- `custom-provider-model-registry`: session re-sync additionally re-discovers a provider when an explicit refresh names it, even with unchanged connection details.

## Impact

- `packages/shared/src/protocol.ts` — `CredentialsUpdatedMessage.refreshProviders?`.
- `packages/shared/src/route-tiers.ts` — tier row for the new route.
- `packages/mcp-server-plugin/src/server/tools.denylist.ts` — denylist the new route.
- `packages/server/src/routes/provider-routes.ts` — new route.
- `packages/extension/src/provider-register.ts` — `reloadProviders(pi, { force })`.
- `packages/extension/src/bridge-handlers/dispatch.ts` — pass `msg.refreshProviders` through.
- `packages/client/src/lib/api/providers-api.ts` — `refreshProviderModels(name)`.
- `packages/client/src/components/settings/ProviderAuthSection.tsx` — row button.
- Client i18n catalog — `providers.refreshModels` (+ in-flight label).
- Built-in / OAuth providers are out of scope (pi's own catalogue).

## Discipline Skills

- `observability-instrumentation` — new endpoint + bridge path: log forced re-registers (provider name + model count, no secrets).
- `security-hardening` — new route touches credential resolution (`resolveProbeApiKey`); must not echo keys, must keep network guard + tier.
- `performance-optimization` — forced re-register runs `/models` discovery on the serialized bridge pump; bounded by the existing discovery timeout, only on explicit user action.
- `review-code` — before commit.
