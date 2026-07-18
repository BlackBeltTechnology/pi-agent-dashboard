# plugins-api.ts — index

Client-side fetch helpers: `listPlugins()` (`GET /api/plugins`), `togglePlugin(id, enabled)` (`POST /api/plugins/:id/toggle`). See change: add-plugin-activation-ui. Adds `writePluginConfig(id, config)` (`POST /api/config/plugins/:id`, rejects on non-2xx) + `dispatchPluginMessage(msg, wsSend)` (routes `plugin_config_write` → REST, else WS). Wired into `App.tsx` PluginContextProvider `send`. See change: fix-plugin-config-write-persistence.
