# DOX — packages/dashboard-plugin-runtime/src/bridge

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `index.ts` | Barrel for `@blackbelt-technology/dashboard-plugin-runtime/bridge` (pure TS, no React/pi). `requestPluginServer(pluginId,type,payload)` calls `globalThis[PLUGIN_REQUEST_SYMBOL]` (`Symbol.for("pi-dashboard.pluginRequest")`, installed by the core bridge while connected) → `PluginLaneReply` `{ok,result}|{ok:false,error}`; never rejects; `unavailable` when the symbol is absent. See change: expose-plugin-credential-and-oauth-seams. |
