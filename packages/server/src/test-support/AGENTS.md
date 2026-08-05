# DOX — packages/server/src/test-support

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `test-server.ts` | Boots real `DashboardServer` on OS-assigned ports for integration tests. Exports `createTestServer(overrides)` → `TestServerHandle { server, httpPort, piPort, stop }`. Safe defaults: `host` `127.0.0.1`, `dev` true, `autoShutdown` false, `tunnel` false. Pairs with `setup-home` setupFile for HOME isolation. |
| `event-loop-lag.ts` | Event-loop lag sampler for tests. Exports `startLagMonitor(intervalMs=10)` -> `{peek,stop}`; measures timer-tick drift, so a tick arriving `interval+N` late means the loop was unavailable ~N ms. Timer is `unref`'d. Added because no existing test measured lag, and "resize runs off the event loop" (D4) is only assertable if blocking is observable. CAVEAT: wall-clock drift also captures GC pauses and cross-thread CPU contention, so a concurrent multi-MB burst reports host noise, not just main-thread blocking — see task 9.5. See change: fit-attachments-for-display. |

