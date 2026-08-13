# plugin-activation-routes.ts — index

REST routes: `GET /api/plugins` (returns `PluginStatus[]` with `displayName`, `requirements`, `missingRequirements`) + `POST /api/plugins/:id/toggle` (writes `plugins.<id>.enabled` via config-api, broadcasts `plugin_config_update`). Auth-gated. Effective at next restart (compared client-side against `/api/health.startedAt`). See change: add-plugin-activation-ui.
