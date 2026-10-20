# usePluginEnabledSet.ts — index

Drives `registry.setEnabledSet(ids)` from `/api/health.plugins[]` snapshot on mount + on every `plugin-config-update` DOM event (re-emitted by `useMessageHandler` from `plugin_config_update` WS). Also primes per-plugin requirement caches. See change: add-plugin-activation-ui.

- Calls `clearFolderProjects()` only when the applied enabled set differs from the previous one (first load = baseline). See change: add-project-scoped-apps.
- Publishes the same `/api/health.plugins[]` read to `pluginAvailability` (`applyPluginStatuses`) on mount + every refresh. Availability drives owned-event group row rendering; it never reaches the reducer. `registry.getAllPluginsForActivationUi()` now returns an array — hook maps to ids. See change: decouple-plugins-from-core.
