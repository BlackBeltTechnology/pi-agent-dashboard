# dashboard-starter.ts — index

Identifies dashboard launcher. `DashboardStarter` = `Bridge` | `Standalone` | `Electron`. → see `dashboard-starter.ts.AGENTS.md` `starterFromHealth(body)` maps a `/api/health` body to `DashboardStarter\|undefined`: static `launchSource` first (never `launchSourceEffective`), legacy `starter` fallback. See change: fix-cli-control-electron-server.
