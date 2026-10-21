# plugins-api.ts — index

Client-side fetch helpers: `listPlugins()` (`GET /api/plugins`), `togglePlugin(id, enabled)` (`POST /api/plugins/:id/toggle`). See change: add-plugin-activation-ui. Adds `writePluginConfig(id, config)` (`POST /api/config/plugins/:id`, rejects on non-2xx) + `dispatchPluginMessage(msg, wsSend)` (routes `plugin_config_write` → REST, else WS). Wired into `App.tsx` PluginContextProvider `send`. See change: fix-plugin-config-write-persistence.

`PluginRow` gains optional `firstParty` (server-computed npm scope; absent ⇒ false) and `claims[].nav` (settings-section promotion hint). See change: promote-model-roles-settings.

`PluginRowStatus` gains `source`, `shadowed`, `restartRequired`, `client` (types from shared `plugin-status`). See change: decouple-plugins-from-core (5.11).

Trust helpers: `trustPluginClient(id, sha256)` (`POST /api/plugins/:id/trust {sha256}`), `trustPluginServer(id)` (`{server:true}`), `revokePluginTrust(id)` (`DELETE`); failures throw `PluginTrustError{status, code}` (`local_only` 403, `stale_hash` 409). See change: decouple-plugins-from-core (task 6.13).
