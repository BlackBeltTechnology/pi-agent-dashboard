# DOX — packages/automation-plugin

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `vitest.config.ts` | Vitest config for automation-plugin package. jsdom env, `pool: "forks"`, `maxWorkers: "50%"`, includes `src/**/__tests__/**/*.test.{ts,tsx}`. globalSetup imports `@blackbelt-technology/pi-dashboard-shared/test-support/setup-home.ts`. |
