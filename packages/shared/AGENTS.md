# DOX — packages/shared

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `vitest.config.ts` | Vitest config for `@blackbelt-technology/pi-dashboard-shared`. Includes `src/**/__tests__/**/*.test.ts`, `environment` `node`, `pool` `forks`, `maxWorkers` `50%`. `globalSetup` runs shared `setup-home.ts`; `setupFiles` run per-file `src/test-support/setup-home-perfile.ts` for HOME isolation under parallelism (See change: `parallelize-test-suite`). |
