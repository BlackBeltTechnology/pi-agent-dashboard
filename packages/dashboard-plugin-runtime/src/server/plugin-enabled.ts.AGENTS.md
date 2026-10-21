# plugin-enabled.ts — index

`resolvePluginEnabled(configValue, defaultEnabled)` — explicit boolean `enabled` in config wins → manifest `defaultEnabled` → else `true`. Lets `browser` ship disabled by default (`defaultEnabled:false`) without changing plugins that omit the field. Honoured by the server loader `isEnabled` (feeds `/api/health.plugins[].enabled`) and `plugin-activation-routes.ts`. Task 2.13 / GAP B.
