# pi-trust-mirror-snapshot.ts — index

Snapshot + trust-store readers shared by bridge and server. `piTrustMirrorSnapshotPath`, `piTrustOverridesPath`, `readPiTrustMirrorSnapshot` (null on absent/corrupt), `readPiTrustFileLockless` (BOM stripped, null=absent, bad shape=unreadable), `nearestRecordedEntry`, `currentHookHash`, `coverSnapshot` (identity + hook re-hash + project-root recheck; nearest rejected reason), `safePiTrustKey`. Read-only, non-throwing, no caches. See change: mirror-dashboard-trust-to-pi.

`readPiTrustMirrorSnapshot` returns `liveCount` (missing/negative/non-integer → 0). See change: mirror-dashboard-trust-live-remote.
