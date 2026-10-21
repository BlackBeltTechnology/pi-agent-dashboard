# DOX — packages/mcp-core

`@blackbelt-technology/pi-dashboard-mcp-core` — host-free library over pi's built-in MCP config. NOT a plugin (no `pi-dashboard-plugin` manifest), so core packages and plugins may import it. Extracted from `mcp-client-plugin/src/core`; the plugin re-exports it as a deprecated `./core`. Consumers: `packages/server` (`server.ts`, `auth/radius-mcp.ts`), `mcp-client-plugin`, `mcp-server-plugin`, `apple-tools`. First npm publish is the irreversible ship point. See change: decouple-plugins-from-core (task 2.2).

Subdirectories: `src/AGENTS.md` (logic + service contract).

| File | Purpose |
|------|---------|
| `README.md` | Package overview: exports table, consumers, deprecation of `mcp-client-plugin/core`. |
| `package.json` | `@blackbelt-technology/pi-dashboard-mcp-core`. `exports`: `.` → `src/index.ts`, `./*.js` → `src/*.ts`, `./schema/*.json`. Deps `pi-dashboard-shared`, `ajv`. In `publish.yml` PACKAGES, `BUNDLED_WORKSPACE_PKGS` (`bundle-server.mjs`), root `vitest.config.ts` projects, `knip.json`. |
| `schema/mcp-config.schema.json` | Published pi 1.1.0 server-entry schema (`ServerEntry`, `$defs.ProjectOverride`); markers `x-secret`, `x-transport`, `x-global-only`. Moved from `mcp-client-plugin/schema`; read by `schema-validation.ts` and the plugin client/tests. |
| `tsconfig.json` | Extends `../../tsconfig.base.json`; `rootDir: src`; `noEmit`. |
| `vitest.config.ts` | node env, forks, `maxWorkers: PARALLEL_MAX_WORKERS`, home-isolation `globalSetup`; aliases `pi-dashboard-shared` to worktree source. |
