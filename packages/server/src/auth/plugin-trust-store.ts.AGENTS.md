# plugin-trust-store.ts — index

The ONE reader/writer of `auth.trustedPlugins`. `readTrustedPlugins()` (typed, live), `findTrustEntry`, `updateTrustedPlugins(mutate)` (read-modify-write of that key ALONE over raw config.json; every other auth/top-level key kept; empty list drops key, empty auth dropped; returns `{before, after}`), `grantClientTrust(id, sha)`, `grantServerTrust(id)`, `revokeTrust(id)`, `TRUST_WRITE_LOCK_KEY`. No locking inside: endpoints (6.12) wrap in `withSettingsWriteLock`. See change: decouple-plugins-from-core (task 6.5, D12).
