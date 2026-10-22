# lock-metadata.ts — index

Read per-HOME dashboard lock sidecar. Exports `DashboardLockMetadata` interface, `getLockMetaPath()`, `readDashboardLockMetadata()` (null on missing/corrupt). Path rooted on shared `getDashboardConfigDir()` (the server's `$HOME`-honouring root; no private `canonicalHomedir`). See change: harden-dashboard-start-detection.
