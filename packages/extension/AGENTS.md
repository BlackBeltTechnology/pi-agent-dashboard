# DOX — packages/extension

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `vitest.config.ts` | Vitest config for extension package. Includes `src/**/__tests__/**/*.test.ts`, node env, `forks` pool, `maxWorkers: "50%"`, globalSetup `setup-home.ts`, per-file HOME isolation via `setup-home-perfile.ts` for `providers.json` write races. |
