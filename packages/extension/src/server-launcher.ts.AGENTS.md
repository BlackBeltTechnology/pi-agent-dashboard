# server-launcher.ts — index

Spawns dashboard server as detached process via shared `launchDashboardServer`. → see `server-launcher.ts.AGENTS.md` `JitiNotFoundError` → `logOwned:false` mapping is jiti-opt-in only; default native launch never needs jiti. See change: fix-appimage-cold-boot-latency.

`buildBridgeEnvOverrides` maps `CONTEXT_MODE_BRIDGE_DEPTH`/`_IDLE_MS` → `undefined` (bridge-auto-started server never inherits them). See change: add-context-mode-settings-plugin.
