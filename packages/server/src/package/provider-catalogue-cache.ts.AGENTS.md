# provider-catalogue-cache.ts — index

In-memory cache of most-recently-pushed provider catalogue (`providers_list` over WS). Last push wins — catalogue is machine-scoped, not per-session. Exports `setCatalogueForSession`, `getLatestCatalogue` (returns `[]` until first push), `_resetForTests`. Read by `GET /api/provider-auth/status`. See changes: replace-hardcoded-provider-lists, simplify-model-selection-channels.

Adds `isCatalogueReady()` + `invalidateCatalogue()`. The cache is explicitly invalidated when the LAST bridge disconnects — previously `latest` was only ever assigned, so a ready signal built on it lied after the first disconnect. See change: redesign-providers-settings-page (D5).
