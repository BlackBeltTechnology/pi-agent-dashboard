# DOX — packages/chat-gateway

Files in this directory. One row per source file. See change: add-chat-gateway.

| File | Purpose |
|------|---------|
| `package.json` | pi-dashboard-plugin manifest. id `chat-gateway`, `priority: 100` (`<= 100` is REQUIRED: the host trust-gates `spawnSession`/`abortSession`/`sendExtensionMessage`/`subscribeSession` at that threshold, so a higher number silently disables the whole gateway). Claims `settings-section`→`ChatGatewaySettings` (tab `general`). `discord.js` is an adapter-local dependency — the only new runtime dep; core packages gain nothing. |
| `tsconfig.json` | Extends `../../tsconfig.base.json`. `jsx: react-jsx`, `noEmit`, `resolveJsonModule`, DOM libs. |
| `vitest.config.ts` | Vitest config, `environment: "node"` (no DOM in the server/adapter suites). `pool: forks`, `PARALLEL_MAX_WORKERS` from repo-root `vitest.workers.ts`, globalSetup `.../shared/test-support/setup-home.ts`. `resolve.alias` maps `dashboard-plugin-runtime` (+ `/server`, `/test-support` BEFORE the bare key) + `pi-dashboard-shared` to worktree-local src — the hoisted-workspace symlink escapes to the main checkout. |
| `NOTICE` | MIT attribution for the vendored `@gamalan/pi-gateway@1.10.1` adapter contract, plus the explicit NOT-vendored list (`index.ts` hub, `sessions/store.ts`, `ask-user-rpc`, upstream `discord.ts`) and why each was dropped. |
