# stream-forward-buffer.ts — index

Bounded retention for `latest`/`stream` plugin channels. `StreamForwardBuffer`: keyed by (pluginId, key value) preserving cross-channel order; `latest` + `group` = one slot per (plugin, group, key) across channels; 2000 msgs / 2MiB per key; per-PLUGIN key budget (64 default, `setMaxKeys` ≤256), oldest key of that plugin evicted; `stats.byPlugin` drop counters; `keyCount` getter. See change: add-plugin-bridge-contributions, move-subagents-to-plugin.
