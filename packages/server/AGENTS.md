# DOX — packages/server

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `vitest.config.ts` | Vitest config for server package. `include` `src/**/__tests__/**/*.test.ts`, `environment` `node`, `pool` `forks`, `maxWorkers` `50%`, `globalSetup` `setup-home.ts`. `setupFiles` resolves config-relative `setup-home-perfile.ts` so worktree-local source wins over hoisted node_modules. `resolve.alias` maps `@blackbelt-technology/pi-dashboard-shared` → `../shared/src` (worktree-local shared wins over hoisted symlink; mirrors client config). See change: `parallelize-test-suite`, fix-and-prefer-model-proxy-resolution. |
