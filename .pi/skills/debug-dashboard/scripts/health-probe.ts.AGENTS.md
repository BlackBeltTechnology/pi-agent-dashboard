# debug-dashboard/scripts/health-probe.ts — index

Probe `GET /api/health`. Base precedence: `PI_DASHBOARD_BASE` → `PI_DASHBOARD_PORT` → `~/.pi/dashboard/config.json` → 8000; invalid environment values fail with an actionable error. Prints mode/uptime/version/launchSource/pid/activeSessions/plugins/proxy; `restartRequired` warning. Flag `--json` for raw. On no response prints "not-running" + tail of `server.log`. See change: fix-reliable-live-control-events.
