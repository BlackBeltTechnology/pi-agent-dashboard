# DOX — packages/dashboard-plugin-skill

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `README.md` | Package overview. pi skill scaffolds dashboard plugins: new plugin package in monorepo, or retrofit existing pi-extension project on disk. Install global `npm i -g @blackbelt-technology/pi-dashboard-plugin-skill` or per-workspace `packages[]` in `~/.pi/agent/settings.json`. |
| `vitest.config.ts` | Vitest config for skill package. node env, forks pool with `singleFork: true`, `src/**/__tests__` include. |
