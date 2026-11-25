# DOX — packages/google-plugin

Files in this directory. One row per source file. See change: add-google-connect.

| File | Purpose |
|------|---------|
| `README.md` | Package overview: what Google Connect owns, built-in app vs organisation sign-in, return paths, leases, operator switches, rollback. See change: add-google-connect. |
| `package.json` | pi-dashboard-plugin manifest. id `google`, priority 200 (before gmail 210), NO `dependsOn`. Claim `settings-section`→`GoogleSettings` (tab `general`). Entries `client`/`server`/`bridge`; `i18nCatalog` `catalog`. Deps `oauth4webapi`, `@fastify/rate-limit`. Public (bundled + published). |
| `tsconfig.json` | Extends `../../tsconfig.base.json`. `jsx: react-jsx`, `noEmit`, DOM libs. |
| `vitest.config.ts` | Vitest config. node env default; client suites opt into jsdom per file. `resolve.alias` → worktree-local runtime + shared src. |
