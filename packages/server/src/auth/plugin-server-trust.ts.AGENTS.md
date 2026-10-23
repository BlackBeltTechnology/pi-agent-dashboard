# plugin-server-trust.ts — index

`isPluginServerTrusted(id, entries)` (entry with `server:true`), `readServerTrustEntries()` (loose read of `auth.trustedPlugins`; empty until 6.5), `isServerTrusted(plugin)` = loader `isServerTrusted` seam: default-deny for `pi-package` server entries/bridges. See change: decouple-plugins-from-core (5.2). `readServerTrustEntries` now reads the typed `auth.trustedPlugins` via `plugin-trust-store.ts` (task 6.5).
