# DOX — packages/server/src/test-support

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `event-loop-lag.ts` | Event-loop lag sampler for tests. Exports `startLagMonitor(intervalMs=10)` -> `{peek,stop}`; measures timer-tick drift, so a tick arriving `interval+N` late means the loop was unavailable ~N ms. Timer is `unref`'d. `peek`/`stop` take a FINAL sample before reading/clearing, so work that blocks from start to stop cannot report 0. CAVEAT: wall-clock drift also captures GC and cross-thread CPU contention — measure outside the vitest runner before drawing conclusions. See change: fit-attachments-for-display. |
| `test-server.ts` | Boots real `DashboardServer` on OS-assigned ports for integration tests. Exports `createTestServer(overrides)` → `TestServerHandle { server, httpPort, piPort, stop }`. Safe defaults: `host` `127.0.0.1`, `dev` true, `autoShutdown` false, `tunnel` false. Pairs with `setup-home` setupFile for HOME isolation. |

