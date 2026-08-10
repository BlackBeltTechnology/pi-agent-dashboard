# home-lock.ts — index

Per-HOME advisory lock ensuring one dashboard instance per `<canonicalHomedir>/.pi/`. Exports `LockMetadata`, `LockAcquireResult`, `AcquireConfig`, `AcquireHooks`, `canonicalHomedir`, `getLockPath`, `getMetaPath`, `writeMetadataAtomic`, `readMetadata`, `removeMetadata`, `isLockHolderResponsive`, `acquireOrAttach`, `isLockDisabled`, `InstanceLockMismatchError`. `acquireOrAttach` returns `{mode:"acquired",release}` or `{mode:"attach",meta}`; steals stale locks, throws on alive-mismatch. Escape hatch `PI_DASHBOARD_ALLOW_MULTIPLE`.
