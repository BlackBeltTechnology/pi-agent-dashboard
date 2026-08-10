# DOX — packages/blackhole-plugin

Files in this directory. One row per source file. See change: add-blackhole-plugin.

| File | Purpose |
|------|---------|
| `README.md` | Package overview. Dashboard settings-section plugin for the `pi-blackhole` extension. Reads/writes `<agentDir>/pi-blackhole/pi-blackhole-config.json` via `GET`+`PUT /api/plugins/blackhole/config`. Scalar accordions + ordered per-worker fallback-chain editor. Fails closed on unparseable config; read-modify-write preserves unmanaged keys. No dependency on `pi-blackhole` (re-declares `BlackholeConfig`). |
| `package.json` | pi-dashboard-plugin manifest. id `blackhole`, priority 100. Single claim `settings-section`→`BlackholeSettings` (tab `general`) — session surfaces deferred to `add-blackhole-session-pipeline`. `client` `./src/client/index.tsx`, `server` `./src/server/index.ts`, `configSchema` `./src/configSchema.json`, `i18nCatalog` `catalog`. `requires.piExtensions: ["pi-blackhole"]` = install prompt only, NOT an activation gate (design D3). |
| `tsconfig.json` | Extends `../../tsconfig.base.json`. `jsx: react-jsx`, `noEmit`, `resolveJsonModule` (vendored config snapshot), DOM libs. |
| `vitest.config.ts` | Vitest config. `@vitejs/plugin-react`, jsdom, `pool: forks`, `maxWorkers: 50%`, globalSetup `@blackbelt-technology/pi-dashboard-shared/test-support/setup-home.ts`. |
