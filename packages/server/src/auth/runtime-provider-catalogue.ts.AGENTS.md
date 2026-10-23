# runtime-provider-catalogue.ts — index

`buildRuntimeCatalogue(source, {customIds, authData, env})` → `ProviderInfo[]` from the server runtime's `getProviders()` + `checkAuth` (no OAuth refresh, no write). `authData===null` → `[]` without `checkAuth`; per-row `checkAuth` reject → unconfigured; whole-build throw → `[]`. `envVar` = first env-shaped name in the auth label that is set. Structural types `RuntimeCatalogueSource` (`checkAuth` required), `AuthCheckLike`. See change: fix-provider-catalogue-first-run (D1).
