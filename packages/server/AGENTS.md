# DOX — packages/server

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `vitest.config.ts` | Vitest config for server package. `include` `src/**/__tests__/**/*.test.ts`, `environment` `node`, `pool` `forks`, `maxWorkers` `50%`, `globalSetup` `setup-home.ts`. `setupFiles` resolves config-relative `setup-home-perfile.ts` so worktree-local source wins over hoisted node_modules. See change: `parallelize-test-suite`. |
