# plugin-config-routes.ts — index

Plugin partial config write. Exports `registerPluginConfigRoutes`. → see `plugin-config-routes.ts.AGENTS.md` Validates a `structuredClone(body)` so Ajv `useDefaults` cannot inject defaults that overwrite stored keys in the merge (partial write = partial). See change: fix-plugin-config-partial-write.
