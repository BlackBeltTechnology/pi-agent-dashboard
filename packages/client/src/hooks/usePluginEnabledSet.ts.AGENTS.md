# usePluginEnabledSet.ts — index

Drives `registry.setEnabledSet(ids)` from `/api/health.plugins[]` snapshot on mount + on every `plugin-config-update` DOM event (re-emitted by `useMessageHandler` from `plugin_config_update` WS). Also primes per-plugin requirement caches. See change: add-plugin-activation-ui.
