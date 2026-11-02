# event-forward-declaration.ts — index

Contract for plugin forward declarations. Exports `REGISTER_EVENT_FORWARD_CHANNEL`, `BRIDGE_READY_CHANNEL`, `RESERVED_EVENT_TYPES`, `validateDeclaration` (channel regex, ≤32/plugin, 256 total, reserved names rejected), `isValidKeyValue` (string/finite number ≤128 chars). See change: add-plugin-bridge-contributions.

`flows_list` dropped from `RESERVED_EVENT_TYPES` (no longer a core message). See change: flows-dock-chip-and-panel-actions.
