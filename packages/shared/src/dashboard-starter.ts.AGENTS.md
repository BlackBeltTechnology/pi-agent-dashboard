# dashboard-starter.ts — index

Identifies dashboard launcher. `DashboardStarter` = `Bridge` | `Standalone` | `Electron`. `parseDashboardStarter(env)` reads `DASHBOARD_STARTER` (default `Standalone`). `LaunchSource` lowercase alias; `parseLaunchSource(env)` maps to `electron` | `bridge` | `standalone` for `/api/health` arm-gating.
