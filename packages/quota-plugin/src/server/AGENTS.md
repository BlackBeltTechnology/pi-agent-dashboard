# DOX — packages/quota-plugin/src/server

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `index.ts` | Server entry (no bridge). `createAuthAdapter()` adapts the host auth abstraction (`readAuthJson` + `getModelRegistry().getApiKeyAndHeaders`, OAuth-refreshing — deep-imported from `@blackbelt-technology/pi-dashboard-server`) to the 2-method `{get,getApiKey}` shape `@latentminds/pi-quotas` expects. `enabledProviders(config)` = SUPPORTED minus `anthropic`, gated on `enabled`+`acknowledgedToS`+per-provider `enabled` (all default-off). `computeQuota()` (exported, unit-tested): zero fetch when gates closed, clears lib cache for non-enabled providers, suppresses `not_applicable`/errors, normalizes windows (Date→ISO, clamp usedPercent, drop windows without valid `windowSeconds`). `toDto()` normalizer. Default `registerPlugin(ctx)`: guarded `GET /api/quota` route (skips if Fastify already listening) + `quota_update` broadcast. Logs provider id + error KIND only — never a token. |
| `__tests__/quota-server.test.ts` | `computeQuota` tests (mock pi-quotas + host modules): gate (plugin/ToS/per-provider off → no fetch), Anthropic excluded, `not_applicable` omitted, windows normalized incl `windowSeconds`, usedPercent clamped, invalid-`windowSeconds` window dropped, cache cleared for disabled providers. |
| `__tests__/credential-path.test.ts` | Via `registerPlugin` + fake ctx: creds resolved through `readAuthJson`+`registry.getApiKeyAndHeaders` (host abstraction, never a file path); token never in `/api/quota` output, logs, or broadcast payload. |
| `__tests__/loader-isolation.test.ts` | Plugin-load-failure isolation: a broken/unavailable dependency is caught by `loadServerEntries`, recorded `loaded:false`+error in the status store (surfaced via `/api/health.plugins[]`), and healthy sibling plugins still load. |

See change: add-provider-quota-plugin.
