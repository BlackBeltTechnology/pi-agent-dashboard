# usePluginToggle.tsx — index

Exports `usePluginList`, `usePluginToggle`, `applyDesiredEnabled`. `usePluginList` owns the `GET /api/plugins` fetch + `plugin-config-update` subscription and layers a DESIRED-state `enabled` overlay on the server's runtime snapshot (which lags until restart); seeded from `GET /api/config`.plugins. `usePluginToggle` owns cascade preview + `cascadeDialog` element, per-row toggling/error state, and restart-required/`restartError` state. Shared by `PluginsSection`, `PluginSettingsPage`, and the settings nav rail. See change: plugin-settings-pages.
