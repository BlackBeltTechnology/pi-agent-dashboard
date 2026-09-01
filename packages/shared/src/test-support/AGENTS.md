# DOX — packages/shared/src/test-support

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `setup-home-perfile.ts` | vitest `setupFiles` hook. Runs inside each worker fork before test file imports. Sets `process.env.HOME = mkdtempSync(os.tmpdir()/pi-test-)` per file. Pre-creates `.pi/agent/sessions` + `.pi/dashboard`. Isolates HOME across parallel forks (maxWorkers "50%"). Complements `setup-home.ts` globalSetup tripwire (kept as second-line guard). Wired in shared/server/extension/subagents-plugin vitest configs via config-relative path (worktree-local source wins over node_modules symlink). No localStorage handling — only client jsdom uses localStorage, isolated in-memory per fork. See change: parallelize-test-suite. Also sets `PI_GATEWAY_TCP ??= "1"` — the gateway TCP listener is opt-in in production (task 8.1) but the server corpus dials `ws://127.0.0.1:<piPort>`. See change: add-pi-gateway-transport-identity. |
| `setup-home.ts` | Vitest `globalSetup` test-isolation tripwire. Default export verifies `process.env.HOME` set + not equal real user home (aborts run before destructive tests touch live `~/.pi/`). Pre-creates `<HOME>/.pi/agent/sessions/` + `<HOME>/.pi/dashboard/`. Warns when HOME outside `os.tmpdir()`. |
