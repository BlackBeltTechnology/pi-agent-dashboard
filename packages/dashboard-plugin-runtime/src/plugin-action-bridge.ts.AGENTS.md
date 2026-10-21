# plugin-action-bridge.ts — index

Client→server `plugin_action` bridge. Exports `PluginActionMessage`, `setSender(sender)` (called by `useWebSocket` on connect), `sendPluginAction(pluginId,sessionId,action,payload)` (no-op when disconnected). Lives in runtime to dodge circular import with client package.
