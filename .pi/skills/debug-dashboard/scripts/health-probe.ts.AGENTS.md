# debug-dashboard/scripts/health-probe.ts — index

Probe `GET /api/health`. Reads port from `~/.pi/dashboard/config.json` (default 8000). Prints mode/uptime/version/launchSource/pid/activeSessions/plugins/proxy; `restartRequired` warning. Flag `--json` for raw. On no response prints "not-running" + tail of `server.log`.
