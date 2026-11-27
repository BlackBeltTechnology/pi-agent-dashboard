# plugin-ownership.ts — index

Manifest ownership table. `buildPluginOwnership(plugins)` → `plugin_ownership {eventTypes: pattern→pluginId, toolClaims: toolName→pluginId}` (tool-renderer claims); `createPluginOwnership(getPlugins)` → `table()` (sent on `session_register`) + `acceptForward(eventType, pluginId)` (ingest guard: owned type must carry owner stamp, rejects counted in `stats.rejectedMisstamped`). Wired in `event-wiring.ts` (`deps.pluginOwnership`, passed by `server.ts`). See change: move-subagents-to-plugin (D1).
