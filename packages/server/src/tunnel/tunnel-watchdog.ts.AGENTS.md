# tunnel-watchdog.ts — index

Tunnel watchdog. Probes `${publicUrl}/api/health` on `intervalMs` (default 60000); 5xx/network/timeout count as failures. After `failureThreshold` (default 2) consecutive failures calls `deleteTunnel()` then `createTunnel()`; on recycle failure backs off ×2 up to ×8 cap. Exports `probeTunnel`, `startTunnelWatchdog`, `stopTunnelWatchdog`, `getTunnelWatchdogStatus`. Tracks `lastProbeAt`, `lastSuccessAt`, `lastFailureAt`, `lastFailureReason`, `consecutiveFailures`, `lastRecycleAt`, `recycleCount`. See change: tunnel-watchdog.
