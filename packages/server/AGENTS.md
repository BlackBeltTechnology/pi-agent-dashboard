# DOX — packages/server

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `bin/pi-dashboard.mjs` | `pi-dashboard` CLI shebang wrapper. Resolves jiti from `argv[1]`'s module graph and re-execs Node with `--import <jiti> src/cli.ts <args>` as a CHILD process; `--version`/`-v` short-circuits without jiti. FORWARDS `SIGTERM`/`SIGINT`/`SIGHUP` to that child — the wrapper owns `argv[1]`, so `kill <pid>`, a supervisor, and Ctrl-C all land on it; without forwarding the server child was orphaned and its exit-intent handler never ran. Re-raises the child's signal after dropping its own listener. See changes: replace-tsx-with-jiti, enable-standalone-npm-install, fix-recovery-exit-intent. |
| `vitest.config.ts` | Vitest config for server package. `include` `src/**/__tests__/**/*.test.ts`, `environment` `node`, `pool` `forks`, `maxWorkers` `50%`, `globalSetup` `setup-home.ts`. `setupFiles` resolves config-relative `setup-home-perfile.ts` so worktree-local source wins over hoisted node_modules. `resolve.alias` maps `@blackbelt-technology/pi-dashboard-shared` → `../shared/src` (worktree-local shared wins over hoisted symlink; mirrors client config). See change: `parallelize-test-suite`, fix-and-prefer-model-proxy-resolution. |
