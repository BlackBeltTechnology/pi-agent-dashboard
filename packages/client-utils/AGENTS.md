# DOX — packages/client-utils

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `vitest.config.ts` | Vitest config for client-utils package. Adds `@vitejs/plugin-react`. jsdom, `pool: "forks"`, `maxWorkers: "50%"`, shared `setup-home.ts` globalSetup. Includes `src/**/__tests__/**/*.test.{ts,tsx}`. No path aliases. |
