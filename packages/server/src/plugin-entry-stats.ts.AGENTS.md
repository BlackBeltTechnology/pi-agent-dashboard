# plugin-entry-stats.ts — index

Manifest-derived replay entry-type provider (`setReplayEntryTypesProvider` / `getReplayEntryTypes` → `{replay, hidden}`), set at boot from discovered plugin manifests (5 s cache) and read by every session load so offline sessions replay plugin entries. `/api/health` `pluginEntries` counters: `declaredReplayTypes`, `replayedPluginEntries` (`recordPluginEntriesReplayed`), `rejectedPluginActions` (`recordRejectedPluginAction`, via `ctx.recordRejectedAction`). See change: update-flows-plugin (D3, task 1.7).
