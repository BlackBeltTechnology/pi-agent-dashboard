# plugin-config-routes.ts — index

Plugin partial config write. Exports `registerPluginConfigRoutes`. `POST /api/config/plugins/:id` validates body against plugin `configSchema`, merges into `~/.pi/dashboard/config.json`, applies schema defaults, broadcasts `plugin_config_update` to browsers. Rejects disabled/unknown plugins.

- Validates a `structuredClone(body)` so Ajv `useDefaults` cannot inject defaults that overwrite stored keys in the merge (partial write = partial). See change: fix-plugin-config-partial-write.
