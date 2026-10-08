# DOX — packages/context-mode-settings-plugin

Files in this directory. One row per source file. See change: add-context-mode-settings-plugin.

| File | Purpose |
|------|---------|
| `README.md` | Package overview. Settings-section plugin for the `context-mode` pi extension. Fixed file `~/.pi/context-mode/settings.json`, logical keys. Two delivery paths: spawn-env contributor (all scopes) + bridge entry (runtime scope). |
| `package.json` | pi-dashboard-plugin manifest. id `context-mode-settings`, priority 100 (trusted, may register spawn-env contributor). Claim `settings-section`→`ContextModeSettings` (tab `general`). `client`/`server`/`bridge` entries, `configSchema`, `i18nCatalog` `catalog`. `requires.piExtensions: ["context-mode"]` (status only). Dep `@fastify/rate-limit`. |
| `tsconfig.json` | Extends `../../tsconfig.base.json`. `jsx: react-jsx`, `noEmit`, DOM libs. |
| `vitest.config.ts` | Vitest config (jsdom, forks, setup-home globalSetup). |
