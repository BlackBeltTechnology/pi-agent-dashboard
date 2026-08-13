# DOX — packages/mcp-server-plugin

Files in this directory. One row per source file. See change: add-dashboard-mcp-server.

| File | Purpose |
|------|---------|
| `package.json` | pi-dashboard-plugin manifest. id `mcp-server`, priority 100, `claims: []` — headless, no client entry. `server` `./src/server/index.ts`. Peer `fastify ^5`. Deliberately claims NO `command-route` `/mcp`: `pi-mcp-adapter` owns the `/mcp` SLASH COMMAND (not an HTTP route), so the pi-side name would collide confusingly. |
| `tsconfig.json` | Extends `../../tsconfig.base.json`. `noEmit`, ES2023. Sets `jsx: react-jsx` ONLY because `dashboard-plugin-runtime/server` transitively reaches `plugin-context.tsx` for `PluginLogger`; this package renders nothing. |
| `vitest.config.ts` | Vitest config. `environment: node` (no jsdom — headless), `pool: forks`, `maxWorkers: 50%`, globalSetup `@blackbelt-technology/pi-dashboard-shared/test-support/setup-home.ts`. Registered in root `vitest.config.ts` `test.projects`. |
