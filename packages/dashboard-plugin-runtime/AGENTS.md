# DOX — packages/dashboard-plugin-runtime

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `README.md` | Package overview. Plugin loader, slot registry, slot consumers, plugin context API, Vite plugin. Public import paths: barrel, `/context` (client hooks), `/server` (loader, `ServerPluginContext`, config validator), `/vite-plugin` (`viteDashboardPluginsPlugin`). Plugins import ONLY these paths; internal-package imports banned (lint fails). Manifest = `pi-dashboard-plugin` field in `package.json`. |
| `vitest.config.ts` | Vitest config for runtime package. jsdom env, forks pool, `src/**/__tests__` include, `globalSetup` from shared test-support. Aliases `@blackbelt-technology/pi-dashboard-shared` to `../shared/src` so worktree-local shared source wins over hoisted symlink. |
