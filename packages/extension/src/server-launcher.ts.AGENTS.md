# server-launcher.ts — index

Spawns dashboard server as detached process via shared `launchDashboardServer`. → see `server-launcher.ts.AGENTS.md` `launchServer` reports `logOwned:true` on every mapped failure (the `JitiNotFoundError` → `logOwned:false` path is removed; callers still honor an explicit `false`). See change: strip-only-native-ts-loader.

`buildBridgeEnvOverrides` maps `CONTEXT_MODE_BRIDGE_DEPTH`/`_IDLE_MS` → `undefined` (bridge-auto-started server never inherits them). See change: add-context-mode-settings-plugin.
