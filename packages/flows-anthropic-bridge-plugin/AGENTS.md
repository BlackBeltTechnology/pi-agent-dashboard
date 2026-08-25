# DOX — packages/flows-anthropic-bridge-plugin

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `README.md` | Package overview. pi-flows-aware bridge plugin. Forwards `@pi/anthropic-messages` hooks into every spawned pi-flows agent subprocess; exposes per-session peer-probe state in Settings. Canonicalizes pi tool names to Claude Code shape (`read`→`Read`, `ask_user`→`mcp__pi__ask_user`), translates responses back, rewrites system prompt. Without bridge, agent tool calls hit Claude allowlist un-prefixed and fail. |
| `vitest.config.ts` | Vitest config for flows-anthropic-bridge-plugin. jsdom env, `src/**/__tests__/**/*.test.{ts,tsx}` include, `pool: "forks"`, `maxWorkers: "50%"`. globalSetup imports `@blackbelt-technology/pi-dashboard-shared/test-support/setup-home.ts`. `resolve.alias` maps both anthropic-messages peer specifiers to `src/__tests__/fixtures/anthropic-messages-stub.ts` — `bridge/index.ts` dynamic-imports optional peers that are not installed in the workspace, so Vite cannot transform it without a stand-in (test-only). See change: warn-missing-anthropic-messages-peer. |
