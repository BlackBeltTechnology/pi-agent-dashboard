# home-lock.js — index

Compiled JS of `home-lock.ts`. Per-HOME advisory lock ensuring one dashboard instance per `<canonicalHomedir>/.pi/`. Exports `canonicalHomedir`, `getLockPath`, `getMetaPath`, `writeMetadataAtomic`, `readMetadata`, `removeMetadata`, `isLockHolderResponsive`, `acquireOrAttach`, `isLockDisabled`, `InstanceLockMismatchError`. Uses `proper-lockfile` (non-blocking, stale 10s) + atomic metadata sidecar.
