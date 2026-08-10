# dashboard-source-decision.ts — index

Pure decision: stamp `source:"dashboard"` on `session_register`? Exports `decideDashboardSource(input)` → `{shouldStamp, consumeLegacyCounter, persistMeta}`. Strong signal `dashboardSpawned===true` stamps + persists to `.meta.json`. `strictCorrelation` (env `STRICT_SPAWN_CORRELATION=1`) suppresses legacy fallback. Legacy cwd-FIFO (`pendingCount>0 && isNewSession`) stamps in-memory only, no sidecar write. See change: fix-dashboard-source-mislabelling, fix-dashboard-spawn-correlation-by-token.
