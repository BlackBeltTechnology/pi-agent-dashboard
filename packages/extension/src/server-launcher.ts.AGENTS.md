# server-launcher.ts — index

Spawns dashboard server as detached process via shared `launchDashboardServer`. → see `server-launcher.ts.AGENTS.md` `launchServer` reports `logOwned:true` on every mapped failure (the `JitiNotFoundError` → `logOwned:false` path is removed; callers still honor an explicit `false`). See change: strip-only-native-ts-loader.

`buildBridgeEnvOverrides` maps `CONTEXT_MODE_BRIDGE_DEPTH`/`_IDLE_MS` → `undefined` (bridge-auto-started server never inherits them). See change: add-context-mode-settings-plugin. `resolveServerCliPath(opts?)` takes injectable `resolve`/`extensionSrcDir`/`exists`; its sibling fallback tries `server` (checkout) then `pi-dashboard-server` (node_modules) and returns the first holding `src/cli.ts`. See change: slim-windows-install-file-count.

`launchServer(config, {nodeBin})` forwards resolved server Node to `launchDashboardServer` (pi's own Node may be below server floor). See change: raise-node-floor-to-26.
