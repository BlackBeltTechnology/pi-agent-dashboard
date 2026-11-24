# DOX — packages/agent-teams-plugin

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `README.md` | Package overview. Plugin id `agent-teams` (unrelated to `team-plugin`). Entries, config, manifest `emits`, test commands. |
| `vitest.config.ts` | Vitest config. Node env, `pool: "forks"`, `maxWorkers: PARALLEL_MAX_WORKERS`, globalSetup `setup-home.ts`, setupFiles `setup-home-perfile.ts`. Includes `src/**/__tests__/**/*.test.{ts,tsx}`. |
