# usePluginEnabledSet.ts — index

Drives `registry.setEnabledSet(ids)` from `/api/health.plugins[]` snapshot on mount + on every `plugin-config-update` DOM event (re-emitted by `useMessageHandler` from `plugin_config_update` WS). Also primes per-plugin requirement caches. See change: add-plugin-activation-ui.

- Calls `clearFolderProjects()` only when the applied enabled set differs from the previous one (first load = baseline). See change: add-project-scoped-apps.
- Publishes the same `/api/health.plugins[]` read to `pluginAvailability` (`applyPluginStatuses`) on mount + every refresh. Availability drives owned-event group row rendering; it never reaches the reducer. `registry.getAllPluginsForActivationUi()` now returns an array — hook maps to ids. See change: decouple-plugins-from-core.

Also calls `setSessionReducerEnabledSet(enabled)` next to `registry.setEnabledSet(enabled)`: plugin session reducer slices/finalizers follow the SAME enabled set as claims (applies to later events only). See change: decouple-plugins-from-core (task 4.2).

`plugins-changed` DOM event (re-emitted by `useMessageHandler` from `plugins_changed`): recomputes the enabled set AND `pluginAvailability` from the broadcast snapshot via shared `applySnapshot`, no `/api/health` refetch. See change: decouple-plugins-from-core (5.18).

`runtime-plugins-registered` DOM event (fired by the runtime loader): re-applies the LAST status snapshot via `applySnapshot` (no refetch) so a runtime plugin registered after the health read joins the default-allow enabled set. No-op before the first read. See change: decouple-plugins-from-core (task 6.14).
