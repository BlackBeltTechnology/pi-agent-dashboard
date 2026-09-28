# DOX — packages/gmail-plugin

Files in this directory. One row per source file. See change: add-gmail-plugin.

| File | Purpose |
|------|---------|
| `README.md` | Package overview. Google Cloud setup (6 wizard steps + error→step table), level/scope table, honest scope limit, tool list, prompt-injection note, storage/revoke, `PI_E2E_GOOGLE_BASE_URL` test override. See change: add-gmail-plugin. |
| `package.json` | pi-dashboard-plugin manifest. id `gmail`, priority 210. Claim `settings-section`→`GmailSettings` (tab `general`). Entries: `client` `./src/client/index.tsx`, `server` `./src/server/index.ts`, `bridge` `./src/bridge/index.ts`; `configSchema` `./src/configSchema.json`; `i18nCatalog` `catalog`. Deps: `oauth4webapi` (PKCE/code/refresh/id_token claims), `@fastify/rate-limit`. Public (bundled + published). See change: add-gmail-plugin. |
| `tsconfig.json` | Extends `../../tsconfig.base.json`. `jsx: react-jsx`, `noEmit`, DOM libs. |
| `vitest.config.ts` | Vitest config. node env default; client suites opt into jsdom per file (`// @vitest-environment jsdom`). `resolve.alias` → worktree-local runtime (`/server`,`/bridge`,`/context`,`/test-support` before bare key) + shared src. See change: add-gmail-plugin. |
