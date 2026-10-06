# DOX — packages/team-plugin

Dashboard plugin: persistent per-user AI team (personas, project teams, conversations) + isolation guard + same-origin app at `/apps/team/`. One row per file. See change: add-team-plugin.

| File | Purpose |
|------|---------|
| `README.md` | Overview, enable + `plugins.team` config (`admins`, `skillCatalog`, `idleMinutes`, `maxConversations`, `teamHome`, `projects`), modes table (multi/single), trust boundary, optional standalone deployment. See change: add-team-plugin. |
| `package.json` | Public manifest. id `team`, priority 100, client `./src/client/index.tsx`, server `./src/server/index.ts`, `i18nCatalog: "catalog"`, claim `sidebar-folder-section`→`FolderTeamSection`. Exports `./client` `./server` `./extension`. `prepack` + `build:app` run `scripts/build-app.mjs`. See change: add-team-plugin. |
| `tsconfig.json` | Type-check config (`noEmit`, `jsx: react-jsx`, DOM lib). See change: add-team-plugin. |
| `vitest.config.ts` | Vitest project. Node env default; client `.tsx` suites opt into jsdom via docblock. Aliases `shared`, `client-utils`, plugin-runtime → worktree source. Registered in root `vitest.config.ts`. See change: add-team-plugin. |
| `scripts/build-app.mjs` | Builds `packages/team-app` (vite API) and copies `dist/` → `dist/app/` (served at `/apps/team/`). No-op when the sibling workspace is absent (tarball consumers keep shipped `dist/app`). Runs on `prepack` and root `npm run build`. See change: add-team-plugin. |
