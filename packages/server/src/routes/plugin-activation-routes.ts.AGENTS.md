# plugin-activation-routes.ts — index

REST routes: `GET /api/plugins` (returns `PluginStatus[]` with `displayName`, `requirements`, `missingRequirements`) + `POST /api/plugins/:id/toggle` (writes `plugins.<id>.enabled` via config-api, broadcasts `plugin_config_update`). Auth-gated. Effective at next restart (compared client-side against `/api/health.startedAt`). See change: add-plugin-activation-ui.

Toggle-off gains LIVE WS teardown (add-browser-relay D1): after the config write + broadcasts, `getWsRouteRegistry().teardownPlugin(id)` for every flipped-off id — tracked sockets close 1001, prefixes tombstone → later upgrades 404, no restart needed. REST routes stay mounted until restart, so `restartRequired: true` stays honest. See change: add-browser-relay.

`GET /api/plugins` rows gain `firstParty` (`isFirstPartyPluginPackage(packageName)`) and claims project `nav` when present. See change: promote-model-roles-settings.

`setPluginsEnabled(id, enabled, {broadcast,repoRoot}, {dryRun?})` extracted from the toggle route (behaviour preserved): returns `{ok,flips,impact,rollback}` | 404 | 409 blockers; `rollback()` restores the previous plugin config blocks. `POST /api/plugins/:id/toggle` now runs under `withSettingsWriteLock(PLUGIN_CONFIG_LOCK_KEY)`. `readRawConfig` exported. See change: addons-hub-feature-catalog.

`setPluginsEnabled` + `rollback()` each broadcast ONE `plugins_changed` (store snapshot) after the per-id `plugin_config_update`s (cascade + restore included). Re-enabling a boot-disabled never-loaded plugin flags its row `restartRequired` (refresh loads NEW ids only); rollback unflags. `GET /api/plugins` also returns removed-but-loaded (`restartRequired`) and `local-detected` rows (synthetic, `packageDir: ""`), one row per id; other store-only ids stay hidden. See change: decouple-plugins-from-core (5.8, 5.10).
