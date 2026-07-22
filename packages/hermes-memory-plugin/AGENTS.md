# DOX — packages/hermes-memory-plugin

Files in this directory. One row per source file. See change: add-hermes-memory-settings-plugin.

| File | Purpose |
|------|---------|
| `README.md` | Package overview. Dashboard settings-section plugin for the `pi-hermes-memory` extension. Reads/writes `~/.pi/agent/hermes-memory-config.json` via `GET`+`PUT /api/plugins/hermes-memory/config`. Full-coverage grouped settings form. Activates only when `pi-hermes-memory` installed (`requires.piExtensions`). Does not depend on the external package (re-declares `MemoryConfig`). |
| `package.json` | pi-dashboard-plugin manifest. id `hermes-memory`, priority 100. Claim `settings-section`→`HermesMemorySettings` (tab `general`). `client` `./src/client/index.tsx`, `server` `./src/server/index.ts`, `configSchema` `./src/configSchema.json`, `i18nCatalog` `catalog`. `requires.piExtensions: ["pi-hermes-memory"]`. |
| `tsconfig.json` | Extends `../../tsconfig.base.json`. `jsx: react-jsx`, `noEmit`, DOM libs. |
| `vitest.config.ts` | Vitest config. `@vitejs/plugin-react`, jsdom, `pool: forks`, `maxWorkers: 50%`, globalSetup `@blackbelt-technology/pi-dashboard-shared/test-support/setup-home.ts`. |
