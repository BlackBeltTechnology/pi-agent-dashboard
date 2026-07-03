# DOX — packages/server/src/test-support

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `test-server.ts` | Boots real `DashboardServer` on OS-assigned ports for integration tests. Exports `createTestServer(overrides)` → `TestServerHandle { server, httpPort, piPort, stop }`. Safe defaults: `host` `127.0.0.1`, `dev` true, `autoShutdown` false, `tunnel` false. Pairs with `setup-home` setupFile for HOME isolation. |
