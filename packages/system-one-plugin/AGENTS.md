# DOX — packages/system-one-plugin

Files in this directory. One row per file. See change: add-system-one-registry.

| File | Purpose |
|------|---------|
| `package.json` | `@blackbelt-technology/pi-dashboard-system-one-plugin`, public. Manifest id `system-one`, displayName "Decision models", priority 200, claim `settings-section` → `SystemOneSettings` (tab `general`), `i18nCatalog: catalog`, client `./src/client/index.tsx`, server `./src/server/index.ts`. Deps: dashboard-plugin-runtime, shared, `pi-system-one`. Registered in electron `BUNDLED_PLUGINS`, `publish.yml` PACKAGES, client deps, `knip.json`, client `index.css` `@source`. See change: add-system-one-registry. |
| `tsconfig.json` | Extends base; `jsx: react-jsx`, DOM libs, `noEmit`. |
| `vitest.config.ts` | jsdom default (server tests opt into `// @vitest-environment node`), `pool: forks`, globalSetup + per-file HOME. Aliases runtime/shared/`pi-system-one` (+ `/capabilities`) to worktree src, subpaths before bare keys. |
