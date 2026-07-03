# DOX — packages/goal-plugin

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `vitest.config.ts` | Vitest config for goal-plugin. `defineConfig` with `@vitejs/plugin-react`. Includes `src/**/__tests__/**/*.test.{ts,tsx}`, jsdom env, `pool: "forks"`, `maxWorkers: "50%"`, globalSetup `@blackbelt-technology/pi-dashboard-shared/test-support/setup-home.ts`. |
