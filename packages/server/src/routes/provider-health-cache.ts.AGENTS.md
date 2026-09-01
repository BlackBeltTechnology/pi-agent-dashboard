# provider-health-cache.ts — index

In-memory per-provider health cache `{ok,status,error,modelCount,testedAt}` (credential-free). Exports `setProviderHealth`, `getAllProviderHealth`, `retainProviderHealth` (prune deleted providers), `clearProviderHealth` (test-only), `ProviderHealth`. Written by `provider-routes` on save + Test; read by `GET /api/providers`. No persistence file, no background poll. See change: surface-provider-health-in-settings.
