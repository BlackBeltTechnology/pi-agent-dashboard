# DOX — packages/flows-anthropic-bridge-plugin/src/bridge

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `index.ts` | pi extension bridge entry for flows-anthropic-bridge. Default-export `activate(ctx)`. Probes peers `@pi/anthropic-messages` + `pi-flows` via `probeAll` (tier-1 Node resolver anchored at cwd, tier-2 `resolvePiPackageEntry` from shared pi-package-resolver). Loads anthropic-messages on both-present, runs default export on main pi instance, builds stable `agentFactory` and emits `flow:register-agent-extension` so spawned flow agents inherit hooks. Re-probes on `session_start`. Status broadcast via `flows-anthropic-bridge:status` event. Contract test `src/__tests__/import-failure-reason.test.ts` pins the resolve-yes/import-no branch's `reason` to the literal `import failed:` prefix the client's Anthropic peer hint matches on (see change: warn-missing-anthropic-messages-peer). |
