# DOX — packages/dashboard-plugin-runtime

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `vitest.config.ts` | Vitest config for runtime package. jsdom env, forks pool, `src/**/__tests__` include, `globalSetup` from shared test-support. Aliases `@blackbelt-technology/pi-dashboard-shared` to `../shared/src` so worktree-local shared source wins over hoisted symlink. |
