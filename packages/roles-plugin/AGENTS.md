# DOX — packages/roles-plugin

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `package.json` | Manifest: `settings-section` claim `BuiltInRolesSettings` (`tab` general, inert) with `nav { group: models, label: "Model roles", description }` → promoted into Settings ▸ Models. See change: promote-model-roles-settings. |
| `README.md` | Package overview. Built-in roles settings UI (`settings-section` slot). Carries the bundled-plugin caveat: discovered by the `packages/*` build scan, NOT from `node_modules`. |
| `vitest.config.ts` | Vitest config for roles-plugin. `include` `src/**/__tests__/**/*.test.{ts,tsx}`, `environment` `jsdom`, `pool` `forks`, `maxWorkers` `PARALLEL_MAX_WORKERS`, `globalSetup` `setup-home.ts`. Uses `@vitejs/plugin-react`. |
