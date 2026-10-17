# DOX — packages/obs-studio-plugin

OBS Studio plugin: `pi-obs` CLI + panel + skill. One row per file. See change: add-obs-studio-plugin.

| File | Purpose |
|------|---------|
| `README.md` | Package overview, quick start, security notes, OBS 32 behaviour. |
| `bin/pi-obs.mjs` | Launcher. Registers shared native-TS loader in-process, imports `src/bin/pi-obs.ts`. Named by service start argv (absolute node + this file + `launch`). |
| `package.json` | pi-dashboard-plugin manifest. id `obs-studio`, priority 215. Claims: `settings-section`→`ObsSettings`, `shell-overlay-route` `/obs/*?` depth 2 (`parentPath` `/settings/plugins/obs-studio`) content→`ObsAppClaim`. bin `pi-obs`. Skill `.pi/skills/obs-studio`. Deps: `obs-websocket-js`, `@fastify/rate-limit`, app-kit, wouter. Public (bundled + published). |
| `tsconfig.json` | Extends base. `jsx: react-jsx`, `noEmit`, DOM libs. |
| `vitest.config.ts` | node env; client suites opt into jsdom per file. Aliases runtime/app-kit/shared to worktree source. |
