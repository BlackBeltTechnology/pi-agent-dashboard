# plugin-status-store.ts — index

In-memory `PluginStatusStore` for `/api/health.plugins[]`. Adds `recordBridgeProbe(pluginId, snapshot)` + `getBridgeProbe(pluginId)`. `listAll()` enriches returned status rows with `lastProbe`. Status-emitting bridge plugins push runtime telemetry via `recordBridgeProbe`; surfaces in health endpoint without dedicated REST route. See change: fix-pi-flows-end-to-end. `removeStatus(id)` drops a row. → see `plugin-status-store.ts.AGENTS.md`
