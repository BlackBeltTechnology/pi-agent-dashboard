# plugin-append-event.ts — index

Host side of `ctx.appendEvent`. `createPluginEventAppender({registry, eventStore, isReplaying, broadcastEvent})` → `(pluginId, sessionId, event) => PluginAppendResult`. Owned type (manifest `eventTypes`) → `insertEvent` + broadcast (store-only while replaying); any other type → `{ok:false,reason:"not-owned"}`, counted, never thrown. See change: move-subagents-to-plugin (D4).
