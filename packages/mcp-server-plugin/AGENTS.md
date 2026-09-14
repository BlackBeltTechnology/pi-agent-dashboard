# DOX — packages/mcp-server-plugin

Files in this directory. One row per source file. See change: add-dashboard-mcp-server.

| File | Purpose |
|------|---------|
| `README.md` | Package overview. Built-in dual-era MCP endpoint at `POST /mcp`: modern `2026-07-28` (handshake-free, streaming) + legacy `2025-03-26`/`2025-06-18`/`2025-11-25` Streamable-HTTP (initialize handshake, opaque `Mcp-Session-Id`, no streaming). Bearer auth + operator-gated direct device-token mint. Carries the bundled-plugin caveat. See change: mcp-legacy-clients-and-token-issuance. |
| `package.json` | pi-dashboard-plugin manifest. id `mcp-server`, priority 100, `claims: []` — headless, no client entry. `server` `./src/server/index.ts`. Peer `fastify ^5`. Deliberately claims NO `command-route` `/mcp`: `pi-mcp-adapter` owns the `/mcp` SLASH COMMAND (not an HTTP route), so the pi-side name would collide confusingly. |
| `tsconfig.json` | Extends `../../tsconfig.base.json`. `noEmit`, ES2023. Sets `jsx: react-jsx` ONLY because `dashboard-plugin-runtime/server` transitively reaches `plugin-context.tsx` for `PluginLogger`; this package renders nothing. |
| `vitest.config.ts` | Vitest config. `environment: node` (no jsdom — headless), `pool: forks`, `maxWorkers: PARALLEL_MAX_WORKERS` (repo-root `vitest.workers.ts`), globalSetup `@blackbelt-technology/pi-dashboard-shared/test-support/setup-home.ts`. Registered in root `vitest.config.ts` `test.projects`. |
