# event-forward-declaration.ts — index

Contract for plugin forward declarations. Exports `REGISTER_EVENT_FORWARD_CHANNEL`, `BRIDGE_READY_CHANNEL`, `RESERVED_EVENT_TYPES`, `validateDeclaration` (channel regex, ≤32/plugin, 256 total, reserved names rejected), `isValidKeyValue` (string/finite number ≤128 chars). See change: add-plugin-bridge-contributions.

`flows_list` dropped from `RESERVED_EVENT_TYPES` (no longer a core message). See change: flows-dock-chip-and-panel-actions.

`subagent_*` names dropped from `RESERVED_EVENT_TYPES`; `plugin_ownership` added (protocol type). Ownership comes from manifest `eventTypes` via the server `plugin_ownership` table. Adds `PluginOwnershipTable`, `REGISTER_TOOL_UPDATE_FILTER_CHANNEL` (`dashboard:register-tool-update-filter`), `ToolUpdateFilterDeclaration/Condition`, optional `group` (latest only) on channel specs, declaration `maxKeys` (`DEFAULT_PLUGIN_MAX_KEYS` 64, `MAX_PLUGIN_MAX_KEYS` 256; larger clamped, `maxKeysRejected`). See change: move-subagents-to-plugin.
