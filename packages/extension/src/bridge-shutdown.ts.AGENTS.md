# bridge-shutdown.ts — index

`BRIDGE_SHUTDOWN_FALLBACK_MS` (5000) + `runBridgeShutdown(ctx, deps?)`: calls `ctx.shutdown()` (errors swallowed), then arms an `unref()`'d `exit(0)` fallback; `exit` / `setTimer` injectable. Called by `bridge.ts` `shutdown` option (server `{type:"shutdown"}`, `/quit`, `/exit`). See change: update-pi-core-1-6-adopt-apis.
